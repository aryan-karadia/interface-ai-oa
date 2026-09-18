import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { RiskClassifier } from "../../src/guardrail/risk-classifier";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T4.2: Risky vs. Reversible Action Policy (ADR-004)", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const adrPath = resolve(rootDir, "docs/adr/ADR-004-risky-vs-reversible-action-policy.md");

  test("ADR-004 exists and documents risk taxonomy, handling modes, and justification", () => {
    expect(existsSync(adrPath)).toBe(true);
    const content = readFileSync(adrPath, "utf-8");

    // Defend taxonomy
    expect(content).toContain("LOW");
    expect(content).toContain("MEDIUM");
    expect(content).toContain("HIGH_IRREVERSIBLE");
    expect(content).toContain("Safe / Reversible");
    expect(content).toContain("Risky / Irreversible");

    // Defend handling modes
    expect(content).toContain("BLOCK");
    expect(content).toContain("CONFIRM");
    expect(content).toContain("FLAG");

    // Defend compliance and financial justification
    expect(content).toContain("HIPAA");
    expect(content).toContain("GLBA");
    expect(content).toContain("SOC-2");
  });

  describe("RiskClassifier Action Classification & Reversibility", () => {
    test("classifies read-only and idempotent actions as LOW / Safe Reversible", () => {
      expect(RiskClassifier.classify({ type: "navigate", url: "http://localhost/search" })).toBe(
        "LOW",
      );
      expect(RiskClassifier.classify({ type: "wait", timeoutMs: 1000 })).toBe("LOW");
      expect(RiskClassifier.classify({ type: "hover" })).toBe("LOW");
      expect(RiskClassifier.classify({ type: "scroll", direction: "down", amount: 100 })).toBe(
        "LOW",
      );
      expect(RiskClassifier.classify({ type: "extract", outputKey: "balance" })).toBe("LOW");

      expect(
        RiskClassifier.isReversible({ type: "navigate", url: "http://localhost/search" }),
      ).toBe(true);
      expect(RiskClassifier.isReversible({ type: "extract", outputKey: "balance" })).toBe(true);
    });

    test("classifies non-destructive form inputs as MEDIUM / Moderate Stateful", () => {
      expect(
        RiskClassifier.classify(
          { type: "fill", valueTemplate: "10042" },
          {
            semantic: { name: "Member ID" },
          },
        ),
      ).toBe("MEDIUM");
      expect(
        RiskClassifier.classify(
          { type: "click" },
          {
            semantic: { name: "Search" },
          },
        ),
      ).toBe("MEDIUM");
      expect(
        RiskClassifier.classify(
          { type: "select", value: "CA" },
          {
            semantic: { name: "Region" },
          },
        ),
      ).toBe("MEDIUM");
    });

    test("classifies destructive keywords in semantic name or anchor as HIGH_IRREVERSIBLE", () => {
      const purgeClick = { type: "click" as const };
      expect(
        RiskClassifier.classify(purgeClick, {
          semantic: { name: "Purge Member Record" },
        }),
      ).toBe("HIGH_IRREVERSIBLE");

      expect(
        RiskClassifier.classify(purgeClick, {
          anchor: { anchorText: "Delete Account Permanently" },
        }),
      ).toBe("HIGH_IRREVERSIBLE");

      expect(
        RiskClassifier.classify(purgeClick, {
          structural: { css: "#ctl00_btnDeleteMember" },
        }),
      ).toBe("HIGH_IRREVERSIBLE");

      expect(
        RiskClassifier.isReversible(purgeClick, {
          semantic: { name: "Purge Member Record" },
        }),
      ).toBe(false);

      const rationale = RiskClassifier.getRiskRationale(purgeClick, {
        semantic: { name: "Purge Member Record" },
      });
      expect(rationale.toLowerCase()).toContain("destructive");
    });

    test("classifies financial triggers as HIGH_IRREVERSIBLE", () => {
      const wireTransfer = { type: "click" as const };
      expect(
        RiskClassifier.classify(wireTransfer, {
          semantic: { name: "Wire Funds Transfer" },
        }),
      ).toBe("HIGH_IRREVERSIBLE");

      expect(
        RiskClassifier.classify(wireTransfer, {
          semantic: { name: "Checkout and Pay $50,000" },
        }),
      ).toBe("HIGH_IRREVERSIBLE");
    });
  });

  describe("Conservative Handling Modes: BLOCK vs CONFIRM vs FLAG", () => {
    const purgeTargeting = {
      semantic: { name: "Purge Member Record" },
      structural: { css: "#ctl00_btnDeleteMember" },
    };

    test("BLOCK mode (default): unconditionally refuses risky action and logs audit violation", () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        highRiskPolicy: "BLOCK", // Autonomous default
      });

      const check = guardrail.checkAction(
        { type: "click" },
        "http://localhost:3000",
        purgeTargeting,
      );
      expect(check.allowed).toBe(false);
      expect(check.riskLevel).toBe("HIGH_IRREVERSIBLE");
      expect(check.violationCategory).toBe("HIGH_RISK_UNAUTHORIZED");
      expect(check.reason).toContain("HIGH_IRREVERSIBLE");

      const logs = guardrail.getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].violationCategory).toBe("HIGH_RISK_UNAUTHORIZED");
    });

    test("CONFIRM mode: blocks when operator confirmation is denied or absent", () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        highRiskPolicy: "CONFIRM",
        operatorConfirmCallback: () => false, // Operator clicks DENY
      });

      const check = guardrail.checkAction(
        { type: "click" },
        "http://localhost:3000",
        purgeTargeting,
      );
      expect(check.allowed).toBe(false);
      expect(check.violationCategory).toBe("HIGH_RISK_UNAUTHORIZED");
      expect(check.reason).toContain("denied by operator");
    });

    test("CONFIRM mode: permits when operator explicitly approves", () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        highRiskPolicy: "CONFIRM",
        operatorConfirmCallback: () => true, // Operator clicks APPROVE
      });

      const check = guardrail.checkAction(
        { type: "click" },
        "http://localhost:3000",
        purgeTargeting,
      );
      expect(check.allowed).toBe(true);
      expect(check.riskLevel).toBe("HIGH_IRREVERSIBLE");
    });

    test("FLAG mode: permits execution while logging audit alert", () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        highRiskPolicy: "FLAG", // Audited mode
      });

      const check = guardrail.checkAction(
        { type: "click" },
        "http://localhost:3000",
        purgeTargeting,
      );
      expect(check.allowed).toBe(true);
      expect(check.riskLevel).toBe("HIGH_IRREVERSIBLE");

      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.reason.includes("audited mode"))).toBe(true);
    });
  });

  describe("Demonstrable Replay Defense: Purge Member Record is blocked", () => {
    test("replay executor halts with HARD_FAILURE when artifact contains destructive Purge action", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      surface.setElement("btn_purge", {
        id: "ctl00_btnDeleteMember",
        text: "Purge Member Record",
        visible: true,
      });

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        highRiskPolicy: "BLOCK",
      });

      const executor = new ReplayExecutor(surface, guardrail);
      const destructiveArtifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "destructive.purge.member",
        name: "Purge Member Record Attempt",
        description: "Attempts to purge a member record",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "legacy-core-portal",
          entryUrl: "http://localhost:3000/portal/search",
          allowedDomains: ["localhost"],
        },
        steps: [
          {
            id: "step_purge_record",
            description: "Click high-risk Purge Member Record button",
            action: { type: "click" },
            targeting: {
              semantic: { name: "Purge Member Record" },
              structural: { css: "#ctl00_btnDeleteMember" },
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "element_visible", targeting: { structural: { css: "#done" } } },
          },
        },
      };

      const result = await executor.execute(destructiveArtifact);
      expect(result.status).toBe("HARD_FAILURE");
      if (result.status === "HARD_FAILURE") {
        expect(result.category).toBe("GUARDRAIL_VIOLATION");
        expect(result.failedStepId).toBe("step_purge_record");
        expect(result.message).toContain("HIGH_IRREVERSIBLE");
      }

      // Check audit log recorded this attempted destruction
      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.violationCategory === "HIGH_RISK_UNAUTHORIZED")).toBe(true);
    });
  });
});
