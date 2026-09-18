import { describe, expect, test } from "bun:test";
import { MockSurface } from "../../src/surface/mock-surface";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { buildArtifact } from "../../src/artifact/compiler";

describe("Replay Result Contract & Business Outcome Separation", () => {
  const baseArtifact = buildArtifact({
    id: "acme.member.query",
    name: "Query Member",
    description: "Queries member account status",
    target: {
      appId: "legacy-portal",
      entryUrl: "http://localhost:3000/portal/search",
      allowedDomains: ["localhost"],
    },
    inputs: {
      memberId: {
        type: "string",
        description: "Member ID to query",
        required: true,
      },
    },
    outputs: {
      memberName: {
        type: "string",
        description: "Member Name",
        sourceStepId: "step_search",
        selector: {
          structural: { css: "out_memberName" },
        },
      },
    },
    steps: [
      {
        id: "step_fill_id",
        description: "Enter member ID",
        action: {
          type: "fill",
          valueTemplate: "{{inputs.memberId}}",
        },
        targeting: {
          semantic: { role: "textbox", name: "Member ID" },
        },
      },
      {
        id: "step_search",
        description: "Click Search",
        action: { type: "click" },
        targeting: {
          semantic: { role: "button", name: "Search" },
        },
      },
    ],
    checkpoint: {
      successCondition: {
        assertion: {
          type: "element_visible",
          targeting: { structural: { css: "member_results_table" } },
        },
        timeoutMs: 3000,
      },
      businessOutcomes: [
        {
          code: "MEMBER_NOT_FOUND",
          description: "No member record found for supplied query",
          detection: {
            type: "text_matches",
            targeting: { structural: { css: "alert_status_msg" } },
            pattern: "No active member records found",
          },
        },
        {
          code: "ACCOUNT_SUSPENDED",
          description: "Member is in suspended status",
          detection: {
            type: "text_matches",
            targeting: { structural: { css: "alert_status_msg" } },
            pattern: "Member account suspended",
          },
        },
      ],
    },
  });

  test("returns SUCCESS when valid member is found and checkpoint passes", async () => {
    const surface = new MockSurface();
    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const executor = new ReplayExecutor(surface, guardrail);

    // Setup Mock DOM elements
    surface.setElement("input_id", {
      role: "textbox",
      name: "Member ID",
      visible: true,
    });
    surface.setElement("btn_search", {
      role: "button",
      name: "Search",
      visible: true,
    });
    surface.setElement("member_results_table", {
      id: "member_results_table",
      visible: true,
    });
    surface.setElement("out_memberName", {
      id: "out_memberName",
      text: "Alice Henderson",
      visible: true,
    });

    const result = await executor.execute(baseArtifact, {
      inputs: { memberId: "10042" },
    });

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.stepsExecuted).toBe(2);
      expect(result.outputs.memberName).toBe("Alice Henderson");
      expect(result.telemetry.stepMetrics).toHaveLength(2);
    }
  });

  test("distinguishes BUSINESS_OUTCOME from crash when member does not exist", async () => {
    const surface = new MockSurface();
    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const executor = new ReplayExecutor(surface, guardrail);

    // Setup Mock DOM elements
    surface.setElement("input_id", {
      role: "textbox",
      name: "Member ID",
      visible: true,
    });
    surface.setElement("btn_search", {
      role: "button",
      name: "Search",
      visible: true,
    });
    // Crucial: Results table does NOT exist. Instead, enterprise alert banner appears:
    surface.setElement("alert_status_msg", {
      id: "alert_status_msg",
      text: "Notice: No active member records found for query",
      visible: true,
    });

    const result = await executor.execute(baseArtifact, {
      inputs: { memberId: "99999" },
    });

    // It must NOT report a crash or unhandled exception!
    expect(result.status).toBe("BUSINESS_OUTCOME");
    if (result.status === "BUSINESS_OUTCOME") {
      expect(result.outcomeCode).toBe("MEMBER_NOT_FOUND");
      expect(result.evidence.detectedText).toContain("No active member records found");
    }
  });

  test("returns RECOVERABLE_RUNTIME_CONDITION when occluded and stopOnRecoverable set", async () => {
    const surface = new MockSurface();
    surface.overlayActive = true; // Simulating modal blocking view
    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const executor = new ReplayExecutor(surface, guardrail);

    surface.setElement("input_id", { role: "textbox", name: "Member ID", visible: true });
    surface.setElement("btn_search", { role: "button", name: "Search", visible: true });

    const result = await executor.execute(baseArtifact, {
      inputs: { memberId: "10042" },
      stopOnRecoverable: true,
    });

    expect(result.status).toBe("RECOVERABLE_RUNTIME_CONDITION");
    if (result.status === "RECOVERABLE_RUNTIME_CONDITION") {
      expect(result.reason).toBe("ELEMENT_OCCLUDED");
      expect(result.suggestedAction).toBe("DISMISS_OVERLAY_AND_RETRY");
    }
  });

  test("returns HARD_FAILURE with GUARDRAIL_VIOLATION when navigating outside allowlist", async () => {
    const surface = new MockSurface();
    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const executor = new ReplayExecutor(surface, guardrail);

    const maliciousArtifact = {
      ...baseArtifact,
      steps: [
        {
          id: "step_evil_nav",
          description: "Navigates to external phishing site",
          action: {
            type: "navigate" as const,
            url: "https://evil-hacker.com/steal",
          },
        },
      ],
    };

    const result = await executor.execute(maliciousArtifact, {
      inputs: { memberId: "10042" },
    });

    expect(result.status).toBe("HARD_FAILURE");
    if (result.status === "HARD_FAILURE") {
      expect(result.category).toBe("GUARDRAIL_VIOLATION");
    }
  });
});
