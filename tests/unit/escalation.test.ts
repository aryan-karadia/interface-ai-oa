import { describe, expect, test } from "bun:test";
import { MockSurface } from "../../src/surface/mock-surface";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import type { EscalationListener, TakeoverRequest, TakeoverResolution } from "../../src/escalation/escalation.interface";

describe("Escalation & Control-Owner State Machine", () => {
  test("manages full lifecycle from automation to human takeover and resumption", async () => {
    const surface = new MockSurface();
    const coordinator = new SessionCoordinator(surface);

    expect(coordinator.getState()).toBe("AUTOMATION_OWNED");

    // Attach mock listener simulating human operator response
    let listenerCalled = false;
    const mockListener: EscalationListener = {
      async onRequest(req: TakeoverRequest): Promise<TakeoverResolution> {
        listenerCalled = true;
        expect(req.reason).toBe("TARGETING_EXHAUSTED");
        expect(coordinator.getState()).toBe("HUMAN_OWNED");
        return {
          requestId: req.id,
          resolvedBy: "operator",
          notes: "Operator resolved captcha and clicked continue",
          resumedAt: new Date().toISOString(),
        };
      },
    };

    coordinator.setListener(mockListener);

    const resolution = await coordinator.requestEscalation(
      "TARGETING_EXHAUSTED",
      "Element could not be found after retries",
      "step_fill_member"
    );

    expect(listenerCalled).toBe(true);
    expect(resolution.resolvedBy).toBe("operator");
    expect(coordinator.getState()).toBe("AUTOMATION_OWNED");
    expect(surface.humanPauseActive).toBe(false);
  });
});
