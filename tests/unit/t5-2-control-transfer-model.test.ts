import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EscalationListener,
  TakeoverRequest,
  TakeoverResolution,
} from "../../src/escalation/escalation.interface";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T5.2: Control-Transfer Model and State Machine (ADR-005)", () => {
  describe("ADR-005 Documentation & Architecture Defenses", () => {
    test("ADR-005 exists and defends the pause/cede/resume seam and ownership state machine", () => {
      const adrPath = join(
        process.cwd(),
        "docs/adr/ADR-005-control-transfer-and-human-escalation.md",
      );
      expect(existsSync(adrPath)).toBe(true);

      const content = readFileSync(adrPath, "utf-8");
      expect(content).toContain("AUTOMATION_OWNED");
      expect(content).toContain("AWAITING_TAKEOVER");
      expect(content).toContain("HUMAN_OWNED");
      expect(content).toContain("HANDOFF_RECONCILIATION");
      expect(content).toContain("pause");
      expect(content).toContain("resume");
      expect(content).toContain("ownership");
    });
  });

  describe("SessionCoordinator State Machine Lifecycle", () => {
    test("initializes in AUTOMATION_OWNED state with initial timeline entry", () => {
      const surface = new MockSurface();
      const coordinator = new SessionCoordinator(surface);

      expect(coordinator.getState()).toBe("AUTOMATION_OWNED");
      expect(coordinator.getActiveRequest()).toBeNull();

      const timeline = coordinator.getOwnershipTimeline();
      expect(timeline.length).toBeGreaterThanOrEqual(1);
      expect(timeline[0].toState).toBe("AUTOMATION_OWNED");
      expect(timeline[0].actor).toBe("system");
    });

    test("executes complete four-stage lifecycle: AUTOMATION_OWNED -> AWAITING_TAKEOVER -> HUMAN_OWNED -> HANDOFF_RECONCILIATION -> AUTOMATION_OWNED", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      const coordinator = new SessionCoordinator(surface);

      const recordedStates: string[] = [];

      const listener: EscalationListener = {
        async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
          // Verify state while human is operating
          recordedStates.push(coordinator.getState());
          expect(coordinator.getState()).toBe("HUMAN_OWNED");
          expect(coordinator.getActiveRequest()?.id).toBe(req.id);

          return {
            requestId: req.id,
            resolvedBy: "operator",
            notes: "Operator resolved unexpected alert dialog",
            resumedAt: new Date().toISOString(),
          };
        },
      };

      coordinator.setListener(listener);

      const resolution = await coordinator.requestEscalation({
        reason: "UNEXPECTED_STATE",
        message: "Modal pop-up blocking element",
        goal: "Lookup Member",
        stepId: "step_2_fill",
        stepIndex: 2,
      });

      expect(resolution.resolvedBy).toBe("operator");
      expect(resolution.notes).toContain("unexpected alert dialog");
      expect(coordinator.getState()).toBe("AUTOMATION_OWNED");
      expect(coordinator.getActiveRequest()).toBeNull();

      // Verify ownership audit timeline
      const timeline = coordinator.getOwnershipTimeline();
      const states = timeline.map((t) => t.toState);

      expect(states).toContain("AUTOMATION_OWNED");
      expect(states).toContain("AWAITING_TAKEOVER");
      expect(states).toContain("HUMAN_OWNED");
      expect(states).toContain("HANDOFF_RECONCILIATION");

      // Verify actors recorded in timeline
      const awaitingTransition = timeline.find((t) => t.toState === "AWAITING_TAKEOVER");
      expect(awaitingTransition?.actor).toBe("automation");

      const humanTransition = timeline.find((t) => t.toState === "HUMAN_OWNED");
      expect(humanTransition?.actor).toBe("operator");

      const reconciliationTransition = timeline.find((t) => t.toState === "HANDOFF_RECONCILIATION");
      expect(reconciliationTransition?.actor).toBe("operator");
    });

    test("freezes automation input and calls surface pause/resume hooks", async () => {
      let pauseCalled = false;
      let resumeCalled = false;

      const surface = new MockSurface();
      surface.pauseForHuman = async (_msg: string) => {
        pauseCalled = true;
      };
      surface.resumeFromHuman = async () => {
        resumeCalled = true;
        return surface.perceive();
      };

      const coordinator = new SessionCoordinator(surface);

      coordinator.setListener({
        async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
          expect(pauseCalled).toBe(true);
          expect(resumeCalled).toBe(false);
          return {
            requestId: req.id,
            resolvedBy: "operator",
            resumedAt: new Date().toISOString(),
          };
        },
      });

      await coordinator.requestEscalation({
        reason: "CAPTCHA_OR_2FA_DETECTED",
        message: "Please complete 2FA challenge",
      });

      expect(pauseCalled).toBe(true);
      expect(resumeCalled).toBe(true);
      expect(coordinator.getState()).toBe("AUTOMATION_OWNED");
    });

    test("disallows triggering escalation when not in AUTOMATION_OWNED state", async () => {
      const surface = new MockSurface();
      const coordinator = new SessionCoordinator(surface);

      // Force state into HUMAN_OWNED
      (coordinator as unknown as { currentState: string }).currentState = "HUMAN_OWNED";

      await expect(
        coordinator.requestEscalation({
          reason: "TARGETING_EXHAUSTED",
          message: "Attempt escalation while human owned",
        }),
      ).rejects.toThrow("Cannot request escalation from state: HUMAN_OWNED");
    });
  });
});
