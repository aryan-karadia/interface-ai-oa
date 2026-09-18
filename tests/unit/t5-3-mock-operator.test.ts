import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MockOperatorSurface } from "../../src/escalation/mock-operator";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T5.3: MockOperatorSurface Unit Tests", () => {
  test("records operator actions with timing and attributes during human takeover", async () => {
    const surface = new MockSurface();
    surface.url = "http://localhost:3000/portal/search";
    surface.setElement("ctl00_btnDismissModal", { id: "ctl00_btnDismissModal", visible: true });

    let actionExecuted = false;
    const operator = new MockOperatorSurface(surface, async (_req, op) => {
      const act = await op.performAction(
        { type: "click" },
        { structural: { css: "#ctl00_btnDismissModal" } },
      );
      actionExecuted = act.success;
      return "Handled modal occlusion";
    });

    const coordinator = new SessionCoordinator(surface);
    coordinator.setListener(operator);

    const resolution = await coordinator.requestEscalation({
      reason: "TARGETING_EXHAUSTED",
      message: "Target occluded by modal",
      goal: "Test Takeover",
      stepId: "step_1",
      stepIndex: 1,
    });

    expect(actionExecuted).toBe(true);
    expect(resolution.resolvedBy).toBe("operator");
    expect(resolution.notes).toBe("Handled modal occlusion");

    const actions = operator.getActionsPerformed();
    expect(actions.length).toBe(1);
    expect(actions[0].action.type).toBe("click");
    expect(actions[0].result.success).toBe(true);
    expect(actions[0].timestamp).toBeDefined();

    const lastRes = operator.getLastResolution();
    expect(lastRes?.notes).toBe("Handled modal occlusion");
  });

  test("captures and redacts evidence into custom output directory", async () => {
    const tmpEvidenceDir = join(process.cwd(), "evidence", "test-handoff-tmp");
    if (existsSync(tmpEvidenceDir)) {
      rmSync(tmpEvidenceDir, { recursive: true, force: true });
    }

    const surface = new MockSurface();
    surface.url = "http://localhost:3000/portal/search";
    surface.setElement("member_pii", {
      id: "member_pii",
      text: "Member SSN: 123-45-6789 Secret: sk-ant-api03-abcdef123456789012345678901234567890",
      visible: true,
    });

    const operator = new MockOperatorSurface(surface, async (_req, op) => {
      await op.performAction({ type: "fill", valueTemplate: "secret-token-123" });
      return "Completed intervention";
    });

    const coordinator = new SessionCoordinator(surface);
    coordinator.setListener(operator);

    await coordinator.requestEscalation({
      reason: "HIGH_RISK_ACTION_CONFIRMATION",
      message: "Confirm sensitive action for SSN: 123-45-6789",
      goal: "Verify PII Redaction in Handoff",
    });

    await operator.captureEvidence(tmpEvidenceDir, coordinator);

    const reqFile = join(tmpEvidenceDir, "intervention-request.json");
    const resFile = join(tmpEvidenceDir, "intervention-resolution.json");
    const timeFile = join(tmpEvidenceDir, "handoff-timeline.json");
    const domFile = join(tmpEvidenceDir, "dom-snapshot-post-handoff.json");

    expect(existsSync(reqFile)).toBe(true);
    expect(existsSync(resFile)).toBe(true);
    expect(existsSync(timeFile)).toBe(true);
    expect(existsSync(domFile)).toBe(true);

    const reqContent = readFileSync(reqFile, "utf-8");
    expect(reqContent).not.toContain("123-45-6789");
    expect(reqContent).toContain("[REDACTED_SSN]");

    const domContent = readFileSync(domFile, "utf-8");
    expect(domContent).not.toContain("123-45-6789");
    expect(domContent).toContain("[REDACTED_SSN]");

    // Clean up temporary test evidence
    rmSync(tmpEvidenceDir, { recursive: true, force: true });
  });
});
