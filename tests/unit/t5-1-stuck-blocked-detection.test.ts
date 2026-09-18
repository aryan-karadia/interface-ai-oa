import { describe, expect, test } from "bun:test";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import { DiscoveryAgent } from "../../src/discovery/agent";
import type { AgentDecision, LLMClient } from "../../src/discovery/llm-client.interface";
import type {
  EscalationListener,
  TakeoverRequest,
  TakeoverResolution,
} from "../../src/escalation/escalation.interface";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T5.1: Stuck / Blocked Detection and Intervention Raising", () => {
  describe("Replay Executor Blocked Condition Detection", () => {
    test("raises takeover request with goal, step, reason, and snapshot when targeting is exhausted", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      surface.title = "LegacyCore Portal - Search";

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
      });
      const coordinator = new SessionCoordinator(surface);

      let capturedRequest: TakeoverRequest | null = null;
      const listener: EscalationListener = {
        async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
          capturedRequest = req;
          return {
            requestId: req.id,
            resolvedBy: "operator",
            notes: "Operator manually located and clicked search button",
            resumedAt: new Date().toISOString(),
          };
        },
      };
      coordinator.setListener(listener);

      const executor = new ReplayExecutor(surface, guardrail, coordinator);

      // Artifact with a completely unlocatable step to trigger targeting exhaustion
      const artifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "test.targeting.exhausted",
        name: "Lookup Member with Broken Targeting",
        description: "Searches for a member in legacy portal",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "legacy-portal",
          entryUrl: "http://localhost:3000/portal/search",
          allowedDomains: ["localhost"],
        },
        steps: [
          {
            id: "step_missing_search_box",
            description: "Fill member ID in missing input box",
            action: { type: "fill", valueTemplate: "10042" },
            targeting: {
              structural: { css: "#completely_non_existent_element_id_xyz" },
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "url_matches", expectedValue: "http://localhost:3000" },
          },
        },
      };

      await executor.execute(artifact);

      expect(capturedRequest).not.toBeNull();
      if (capturedRequest) {
        expect((capturedRequest as TakeoverRequest).reason).toBe("TARGETING_EXHAUSTED");
        expect((capturedRequest as TakeoverRequest).goal).toBe(
          "Lookup Member with Broken Targeting",
        );
        expect((capturedRequest as TakeoverRequest).stepId).toBe("step_missing_search_box");
        expect((capturedRequest as TakeoverRequest).currentUrl).toBe(
          "http://localhost:3000/portal/search",
        );
        expect((capturedRequest as TakeoverRequest).message).toContain("step_missing_search_box");
        expect((capturedRequest as TakeoverRequest).snapshot).toBeDefined();
        expect((capturedRequest as TakeoverRequest).timestamp).toBeDefined();
      }
    });

    test("raises takeover request when modal occlusion retries are exhausted", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      // Simulate active modal that occludes elements
      surface.overlayActive = true;

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
      });
      const coordinator = new SessionCoordinator(surface);

      let capturedRequest: TakeoverRequest | null = null;
      coordinator.setListener({
        async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
          capturedRequest = req;
          surface.overlayActive = false; // Human dismisses modal
          return {
            requestId: req.id,
            resolvedBy: "operator",
            notes: "Dismissed modal manually",
            resumedAt: new Date().toISOString(),
          };
        },
      });

      const executor = new ReplayExecutor(surface, guardrail, coordinator);
      const occludedArtifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "test.modal.occluded",
        name: "Test Modal Occlusion Escalation",
        description: "Attempts clicking behind an active modal overlay",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "legacy-portal",
          entryUrl: "http://localhost:3000/portal/search",
          allowedDomains: ["localhost"],
        },
        steps: [
          {
            id: "step_click_behind_modal",
            description: "Click search button",
            action: { type: "click" },
            targeting: {
              structural: { css: "#ctl00_btnSearch" },
            },
            recovery: {
              maxRetries: 1,
              dismissOverlaysBeforeRetry: false, // Prevents auto dismissal to force retry exhaustion
            },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: { type: "url_matches", expectedValue: "http://localhost:3000" },
          },
        },
      };

      surface.setElement("ctl00_btnSearch", { id: "ctl00_btnSearch", visible: true });

      await executor.execute(occludedArtifact);

      expect(capturedRequest).not.toBeNull();
      const req = capturedRequest as TakeoverRequest | null;
      expect(req?.goal).toBe("Test Modal Occlusion Escalation");
      expect(req?.stepId).toBe("step_click_behind_modal");
    });
  });

  describe("Discovery Agent Stuck Condition Detection", () => {
    test("raises takeover request when discovery loop detects dead-end or consecutive repetitive action loop", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
      });
      const coordinator = new SessionCoordinator(surface);

      let capturedRequest: TakeoverRequest | null = null;
      coordinator.setListener({
        async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
          capturedRequest = req;
          return {
            requestId: req.id,
            resolvedBy: "operator",
            notes: "Operator navigated past the dead end",
            resumedAt: new Date().toISOString(),
          };
        },
      });

      // Mock LLM that endlessly repeats the exact same action without making progress
      const stuckLLM: LLMClient = {
        generateDecision: async (): Promise<AgentDecision> => ({
          thought: "I am looping endlessly on this button",
          action: { type: "click" },
          targeting: { structural: { css: "#same_button" } },
          goalMet: false,
        }),
      };

      surface.setElement("same_button", { id: "same_button", visible: true });

      const agent = new DiscoveryAgent(surface, stuckLLM, guardrail, coordinator);
      const _result = await agent.discover({
        appId: "test-app",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
        goal: "Navigate through portal to claims",
        maxSteps: 5,
        maxConsecutiveIdenticalActions: 2,
      });

      expect(capturedRequest).not.toBeNull();
      if (capturedRequest) {
        expect((capturedRequest as TakeoverRequest).reason).toBe("DEAD_END_DETECTED");
        expect((capturedRequest as TakeoverRequest).goal).toBe("Navigate through portal to claims");
        expect((capturedRequest as TakeoverRequest).message).toContain(
          "repetitive action dead-end",
        );
        expect((capturedRequest as TakeoverRequest).currentUrl).toBe(
          "http://localhost:3000/portal/search",
        );
      }
    });
  });
});
