import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";
import { PlaywrightSurface } from "../../src/surface/playwright-surface";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";

describe("T3.1: Deterministic Replay Executor (Zero LLM)", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const artifactPath = resolve(
    rootDir,
    "artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json"
  );

  test("unit: replays steps deterministically with input interpolation and output extraction", async () => {
    const surface = new MockSurface();
    surface.setElement("input_member", {
      role: "textbox",
      name: "Member ID",
      visible: true,
    });
    surface.setElement("btn_search", {
      role: "button",
      name: "Search",
      visible: true,
    });
    surface.setElement("ctl00_gridMemberDetails", {
      text: "Alice Henderson - Active",
      visible: true,
    });
    surface.setElement("ctl00_out_fullName", {
      text: "Alice M. Henderson",
      visible: true,
    });

    const guardrail = new GuardrailService({
      allowedDomains: ["localhost", "127.0.0.1"],
    });

    const executor = new ReplayExecutor(surface, guardrail);
    const rawArtifact: ArtifactSpec = JSON.parse(readFileSync(artifactPath, "utf-8"));

    const result = await executor.execute(rawArtifact, {
      inputs: { memberId: "10042" },
    });

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.stepsExecuted).toBe(3);
      expect(result.outputs.memberName).toBe("Alice M. Henderson");
      expect(result.telemetry.stepMetrics).toHaveLength(3);
    }
  });

  describe("live integration with proxy target", () => {
    const testPort = 3089;
    let server: ReturnType<typeof startLegacyPortalServer>;
    let surface: PlaywrightSurface;

    beforeAll(async () => {
      server = startLegacyPortalServer(testPort);
      surface = new PlaywrightSurface({ headless: true });
      await surface.initialize();
    });

    afterAll(async () => {
      await surface.close();
      server.stop();
    });

    test("replays Sprint 2 artifact against live target, reproducing discovery outcome with NO LLM", async () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost", "127.0.0.1"],
      });

      const executor = new ReplayExecutor(surface, guardrail);
      const rawArtifact: ArtifactSpec = JSON.parse(readFileSync(artifactPath, "utf-8"));

      // Point entryUrl to test server port
      const testArtifact: ArtifactSpec = {
        ...rawArtifact,
        target: {
          ...rawArtifact.target,
          entryUrl: `http://localhost:${testPort}/portal/search`,
        },
        steps: rawArtifact.steps.map((step) => {
          if (step.action.type === "navigate") {
            return {
              ...step,
              action: {
                ...step.action,
                url: `http://localhost:${testPort}/portal/search`,
              },
            };
          }
          return step;
        }),
      };

      const result = await executor.execute(testArtifact, {
        inputs: { memberId: "10042" },
      });

      expect(result.status).toBe("SUCCESS");
      if (result.status === "SUCCESS") {
        expect(result.artifactId).toBe("legacy.portal.lookup_member");
        expect(result.stepsExecuted).toBe(3);
        expect(result.outputs.memberName).toBe("Alice M. Henderson");
        expect(result.checkpointValidation.matchedAssertion).toContain("element_visible");
        expect(result.telemetry.stepMetrics).toHaveLength(3);

        // Verify that each step metric recorded duration and targeting tier
        const fillStep = result.telemetry.stepMetrics.find((s) => s.actionType === "fill");
        expect(fillStep).toBeDefined();
        expect(fillStep?.success).toBe(true);

        const clickStep = result.telemetry.stepMetrics.find((s) => s.actionType === "click");
        expect(clickStep).toBeDefined();
        expect(clickStep?.success).toBe(true);
      }
    });
  });
});
