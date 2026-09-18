import type { Surface } from "../surface/surface.interface";
import type {
  ControlOwner,
  TakeoverRequest,
  TakeoverResolution,
  EscalationListener,
} from "./escalation.interface";

export class SessionCoordinator {
  private currentState: ControlOwner = "AUTOMATION_OWNED";
  private activeRequest: TakeoverRequest | null = null;
  private listener: EscalationListener | null = null;

  constructor(private surface: Surface) {}

  getState(): ControlOwner {
    return this.currentState;
  }

  getActiveRequest(): TakeoverRequest | null {
    return this.activeRequest;
  }

  setListener(listener: EscalationListener): void {
    this.listener = listener;
  }

  /**
   * Automation triggers an escalation request, transitioning to AWAITING_TAKEOVER
   */
  async requestEscalation(
    reason: TakeoverRequest["reason"],
    message: string,
    stepId?: string,
    suggestedAction?: string
  ): Promise<TakeoverResolution> {
    if (this.currentState !== "AUTOMATION_OWNED") {
      throw new Error(`Cannot request escalation from state: ${this.currentState}`);
    }

    const snapshot = await this.surface.perceive().catch(() => undefined);
    const request: TakeoverRequest = {
      id: `esc_${Date.now()}`,
      stepId,
      reason,
      message,
      currentUrl: snapshot?.url || "unknown",
      snapshot,
      suggestedAction,
      timestamp: new Date().toISOString(),
    };

    this.activeRequest = request;
    this.currentState = "AWAITING_TAKEOVER";

    // Pause surface automation
    await this.surface.pauseForHuman(message);

    if (this.listener) {
      this.currentState = "HUMAN_OWNED";
      const resolution = await this.listener.onRequest(request);
      return this.reclaimControl(resolution);
    }

    // Default resolution if no listener attached (e.g. automated test)
    return {
      requestId: request.id,
      resolvedBy: "operator",
      notes: "Auto-resolved (no active operator listener)",
      resumedAt: new Date().toISOString(),
    };
  }

  /**
   * Human operator completes intervention and hands control back to automation
   */
  async reclaimControl(resolution: TakeoverResolution): Promise<TakeoverResolution> {
    this.currentState = "HANDOFF_RECONCILIATION";

    // Resume surface and verify state
    await this.surface.resumeFromHuman();

    this.currentState = "AUTOMATION_OWNED";
    this.activeRequest = null;
    return resolution;
  }
}
