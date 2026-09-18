import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import { ArtifactRepository } from "../../src/artifact/repository";
import { MockOperatorSurface } from "../../src/escalation/mock-operator";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { PlaywrightSurface } from "../../src/surface/playwright-surface";

describe("T5.3: Mock Operator Surface & Handoff Evidence Capture", () => {
  test("end-to-end demo: automation pauses -> human operator acts -> resumes -> completes, capturing evidence in /evidence/handoff/", async () => {
    const port = 3097;
    const server: Server<unknown> = startLegacyPortalServer(port);
    const handoffEvidenceDir = join(process.cwd(), "evidence", "handoff");

    const surface = new PlaywrightSurface({ headless: true });
    try {
      await surface.initialize();
      await surface.navigate(`http://localhost:${port}/portal/search`);

      // Fill in member ID first so search is ready
      await surface.act(
        { type: "fill", valueTemplate: "10042" },
        { structural: { css: "#ctl00_MainContent_tabSearch_txtMemberId_8912" } },
      );

      // Trigger the maintenance notice modal to occlude the search button
      await surface.act(
        { type: "click" },
        { structural: { css: 'a[href="/portal/maintenance"]' } },
      );

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        allowedPathPrefixes: ["/portal"],
      });

      const coordinator = new SessionCoordinator(surface);

      // Human operator takeover implementation
      const operator = new MockOperatorSurface(surface, async (request, op) => {
        expect(request.reason).toBe("TARGETING_EXHAUSTED");
        expect(coordinator.getState()).toBe("HUMAN_OWNED");

        // Human operator inspects screen and dismisses the occluding modal
        const clickDismiss = await op.performAction(
          { type: "click" },
          { structural: { css: "#ctl00_btnDismissModal" } },
        );
        expect(clickDismiss.success).toBe(true);

        return "Operator dismissed modal popup blocking search button";
      });

      coordinator.setListener(operator);

      const repo = new ArtifactRepository();
      const artifact = await repo.load(
        "legacy-core-portal",
        "legacy.portal.lookup_member",
        "1.0.0",
      );
      expect(artifact).not.toBeNull();
      if (!artifact) return;

      // Create test artifact targeting the occluded search button with fast recovery
      const testArtifact: ArtifactSpec = {
        ...artifact,
        target: {
          ...artifact.target,
          entryUrl: `http://localhost:${port}/portal/search`,
        },
        steps: [
          {
            id: "step_click_search",
            description: "Click the Search button (blocked by modal)",
            action: { type: "click" },
            targeting: {
              structural: { css: "#ctl00_MainContent_btnSearch_329a" },
            },
            recovery: {
              maxRetries: 0,
              dismissOverlaysBeforeRetry: false,
            },
          },
        ],
      };

      const executor = new ReplayExecutor(surface, guardrail, coordinator);

      // Execute replay
      const replayResult = await executor.execute(testArtifact, {
        inputs: { memberId: "10042" },
      });

      // Automation should pause, human dismisses modal, automation resumes and succeeds!
      expect(replayResult.status).toBe("SUCCESS");
      if (replayResult.status === "SUCCESS") {
        expect(replayResult.outputs?.memberName).toBe("Alice M. Henderson");
      }

      // Capture and persist complete handoff evidence
      await operator.captureEvidence(handoffEvidenceDir, coordinator);

      // Verify evidence artifacts written to disk
      const reqPath = join(handoffEvidenceDir, "intervention-request.json");
      const resPath = join(handoffEvidenceDir, "intervention-resolution.json");
      const timePath = join(handoffEvidenceDir, "handoff-timeline.json");
      const domPath = join(handoffEvidenceDir, "dom-snapshot-post-handoff.json");

      expect(existsSync(reqPath)).toBe(true);
      expect(existsSync(resPath)).toBe(true);
      expect(existsSync(timePath)).toBe(true);
      expect(existsSync(domPath)).toBe(true);

      // Inspect intervention request
      const reqData = JSON.parse(readFileSync(reqPath, "utf-8"));
      expect(reqData.reason).toBe("TARGETING_EXHAUSTED");
      expect(reqData.goal).toBe("Lookup Member Account");
      expect(reqData.currentUrl).toContain(`:${port}/portal/search`);

      // Inspect intervention resolution and operator actions
      const resData = JSON.parse(readFileSync(resPath, "utf-8"));
      expect(resData.resolution.resolvedBy).toBe("operator");
      expect(resData.resolution.notes).toContain("Operator dismissed modal popup");
      expect(resData.operatorActions.length).toBe(1);
      expect(resData.operatorActions[0].action.type).toBe("click");
      expect(resData.operatorActions[0].result.success).toBe(true);

      // Inspect ownership timeline
      const timelineData = JSON.parse(readFileSync(timePath, "utf-8"));
      expect(timelineData.length).toBeGreaterThanOrEqual(4);
      const states = timelineData.map((t: { toState: string }) => t.toState);
      expect(states).toContain("AWAITING_TAKEOVER");
      expect(states).toContain("HUMAN_OWNED");
      expect(states).toContain("HANDOFF_RECONCILIATION");
      expect(states).toContain("AUTOMATION_OWNED");
    } finally {
      await surface.close();
      server.stop();
    }
  }, 25000);
});
