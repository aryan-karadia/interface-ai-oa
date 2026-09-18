import { describe, expect, test } from "bun:test";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import { DiscoveryAgent } from "../../src/discovery/agent";
import type { AgentDecision, LLMClient } from "../../src/discovery/llm-client.interface";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";
import type { SurfaceSnapshot } from "../../src/surface/surface.interface";

describe("T4.1: Configurable Allowlist (Domains, Routes, Action Types)", () => {
  describe("Policy verification in GuardrailService", () => {
    const policy = {
      allowedDomains: ["portal.enterprise.internal", "localhost"],
      allowedPathPrefixes: ["/portal/search", "/portal/members"],
      allowedActionTypes: ["navigate", "fill", "click", "wait", "extract"],
    };
    const guardrail = new GuardrailService(policy);

    test("allows permitted domain and permitted route", () => {
      const result = guardrail.checkAction(
        { type: "navigate", url: "https://portal.enterprise.internal/portal/search" },
        "about:blank",
      );
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe("LOW");
    });

    test("blocks navigation to unpermitted external domain and logs audit entry", () => {
      guardrail.clearAuditLogs();
      const result = guardrail.checkAction(
        { type: "navigate", url: "https://attacker.example.com/exfiltrate" },
        "https://portal.enterprise.internal/portal/search",
      );
      expect(result.allowed).toBe(false);
      expect(result.violationCategory).toBe("FORBIDDEN_DOMAIN");
      expect(result.reason).toContain("attacker.example.com");

      const logs = guardrail.getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].violationCategory).toBe("FORBIDDEN_DOMAIN");
      expect(logs[0].actionType).toBe("navigate");
      expect(logs[0].targetUrl).toBe("https://attacker.example.com/exfiltrate");
    });

    test("blocks navigation to unpermitted route prefix on permitted domain and logs audit entry", () => {
      guardrail.clearAuditLogs();
      const result = guardrail.checkAction(
        { type: "navigate", url: "https://portal.enterprise.internal/admin/system-wipe" },
        "https://portal.enterprise.internal/portal/search",
      );
      expect(result.allowed).toBe(false);
      expect(result.violationCategory).toBe("FORBIDDEN_PATH");
      expect(result.reason).toContain("/admin/system-wipe");

      const logs = guardrail.getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].violationCategory).toBe("FORBIDDEN_PATH");
    });

    test("blocks actions on current page if session navigated outside permitted route", () => {
      guardrail.clearAuditLogs();
      const result = guardrail.checkAction(
        { type: "click" },
        "https://portal.enterprise.internal/unauthorized-internal/settings",
      );
      expect(result.allowed).toBe(false);
      expect(result.violationCategory).toBe("FORBIDDEN_PATH");
      expect(guardrail.getAuditLogs().length).toBe(1);
    });

    test("blocks unapproved action types outside allowedActionTypes and logs audit entry", () => {
      guardrail.clearAuditLogs();
      const result = guardrail.checkAction(
        // "hover" is not in ["navigate", "fill", "click", "wait", "extract"]
        { type: "hover" as any },
        "https://portal.enterprise.internal/portal/search",
      );
      expect(result.allowed).toBe(false);
      expect(result.violationCategory).toBe("DISALLOWED_ACTION_TYPE");
      expect(result.reason).toContain("hover");

      const logs = guardrail.getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].violationCategory).toBe("DISALLOWED_ACTION_TYPE");
      expect(logs[0].actionType).toBe("hover");
    });
  });

  describe("Enforcement at Discovery Time", () => {
    test("discovery agent refuses to execute out-of-allowlist domain action and logs violation", async () => {
      const surface = new MockSurface();
      const guardrail = new GuardrailService({
        allowedDomains: ["internal.portal.com"],
        allowedPathPrefixes: ["/app"],
        allowedActionTypes: ["navigate", "click", "fill"],
      });

      // Mock LLM that attempts to navigate to external site
      const rogueLLM: LLMClient = {
        generateDecision: async (_snapshot: SurfaceSnapshot): Promise<AgentDecision> => ({
          thought: "I need to check documentation on an external site",
          action: { type: "navigate", url: "https://evil.external.com/docs" },
          goalMet: false,
        }),
      };

      const agent = new DiscoveryAgent(surface, rogueLLM, guardrail);
      const result = await agent.discover({
        appId: "test-app",
        entryUrl: "https://internal.portal.com/app",
        allowedDomains: ["internal.portal.com"],
        goal: "Search for records",
        maxSteps: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Guardrail blocked action");
      expect(result.error).toContain("evil.external.com");

      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.violationCategory === "FORBIDDEN_DOMAIN")).toBe(true);
      // Ensure surface did not actually navigate to evil site
      expect(surface.url).not.toBe("https://evil.external.com/docs");
    });

    test("discovery agent refuses to execute disallowed action type and logs violation", async () => {
      const surface = new MockSurface();
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        allowedActionTypes: ["navigate", "click", "fill"],
      });

      const rogueActionLLM: LLMClient = {
        generateDecision: async (): Promise<AgentDecision> => ({
          thought: "Let me execute an unapproved hover action",
          action: { type: "hover" as any },
          goalMet: false,
        }),
      };

      const agent = new DiscoveryAgent(surface, rogueActionLLM, guardrail);
      const result = await agent.discover({
        appId: "test-app",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
        goal: "Search for records",
        maxSteps: 2,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Guardrail blocked action");
      expect(result.error).toContain("hover");
      expect(
        guardrail.getAuditLogs().some((l) => l.violationCategory === "DISALLOWED_ACTION_TYPE"),
      ).toBe(true);
    });
  });

  describe("Enforcement at Replay Time", () => {
    test("replay executor blocks out-of-allowlist domain step with HARD_FAILURE and logs audit entry", async () => {
      const surface = new MockSurface();
      const guardrail = new GuardrailService({
        allowedDomains: ["trusted.bank.corp"],
        allowedActionTypes: ["navigate", "click", "fill"],
      });

      const executor = new ReplayExecutor(surface, guardrail);
      const maliciousArtifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "malicious.artifact.attempt",
        name: "Exfiltration Attempt",
        description: "Attempts out-of-bounds navigation",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "bank-app",
          entryUrl: "https://trusted.bank.corp/login",
          allowedDomains: ["trusted.bank.corp"],
        },
        steps: [
          {
            id: "step_exfiltrate",
            description: "Navigate to attacker server",
            action: {
              type: "navigate",
              url: "https://phishing-catcher.com/steal",
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "element_visible", targeting: { structural: { css: "#done" } } },
          },
        },
      };

      const result = await executor.execute(maliciousArtifact);
      expect(result.status).toBe("HARD_FAILURE");
      if (result.status === "HARD_FAILURE") {
        expect(result.category).toBe("GUARDRAIL_VIOLATION");
        expect(result.failedStepId).toBe("step_exfiltrate");
        expect(result.message).toContain("phishing-catcher.com");
      }

      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.violationCategory === "FORBIDDEN_DOMAIN")).toBe(true);
      expect(surface.url).not.toBe("https://phishing-catcher.com/steal");
    });

    test("replay executor blocks out-of-allowlist route step with HARD_FAILURE and logs audit entry", async () => {
      const surface = new MockSurface();
      const guardrail = new GuardrailService({
        allowedDomains: ["trusted.bank.corp"],
        allowedPathPrefixes: ["/app/safe-query"],
        allowedActionTypes: ["navigate", "click", "fill"],
      });

      const executor = new ReplayExecutor(surface, guardrail);
      const rogueRouteArtifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "rogue.route.attempt",
        name: "Route Escapement Attempt",
        description: "Attempts out-of-bounds route access",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "bank-app",
          entryUrl: "https://trusted.bank.corp/app/safe-query",
          allowedDomains: ["trusted.bank.corp"],
        },
        steps: [
          {
            id: "step_admin_access",
            description: "Attempt accessing forbidden root admin route",
            action: {
              type: "navigate",
              url: "https://trusted.bank.corp/super-admin/privileged-purge",
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "element_visible", targeting: { structural: { css: "#done" } } },
          },
        },
      };

      const result = await executor.execute(rogueRouteArtifact);
      expect(result.status).toBe("HARD_FAILURE");
      if (result.status === "HARD_FAILURE") {
        expect(result.category).toBe("GUARDRAIL_VIOLATION");
        expect(result.failedStepId).toBe("step_admin_access");
        expect(result.message).toContain("/super-admin/privileged-purge");
      }

      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.violationCategory === "FORBIDDEN_PATH")).toBe(true);
    });

    test("replay executor blocks disallowed action type step with HARD_FAILURE", async () => {
      const surface = new MockSurface();
      const guardrail = new GuardrailService({
        allowedDomains: ["trusted.bank.corp"],
        allowedActionTypes: ["navigate", "fill", "click"],
      });

      const executor = new ReplayExecutor(surface, guardrail);
      const rogueActionArtifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "rogue.action.attempt",
        name: "Disallowed Action Attempt",
        description: "Attempts an unapproved action type",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "bank-app",
          entryUrl: "https://trusted.bank.corp/portal",
          allowedDomains: ["trusted.bank.corp"],
        },
        steps: [
          {
            id: "step_unapproved_hover",
            description: "Attempt unapproved hover action",
            action: {
              type: "hover" as any,
            },
            targeting: {
              structural: { css: "#menu" },
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "element_visible", targeting: { structural: { css: "#done" } } },
          },
        },
      };

      const result = await executor.execute(rogueActionArtifact);
      expect(result.status).toBe("HARD_FAILURE");
      if (result.status === "HARD_FAILURE") {
        expect(result.category).toBe("GUARDRAIL_VIOLATION");
        expect(result.failedStepId).toBe("step_unapproved_hover");
        expect(result.message).toContain("hover");
      }

      const logs = guardrail.getAuditLogs();
      expect(logs.some((l) => l.violationCategory === "DISALLOWED_ACTION_TYPE")).toBe(true);
    });
  });
});
