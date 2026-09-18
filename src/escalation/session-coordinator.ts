import type { Surface } from "../surface/surface.interface";
import type {
  ControlOwner,
  EscalationListener,
  TakeoverRequest,
  TakeoverResolution,
} from "./escalation.interface";

export interface RequestEscalationParams {
  reason: TakeoverRequest["reason"];
  message: string;
  goal?: string;
  stepId?: string;
  stepIndex?: number;
  suggestedAction?: string;
}

export interface OwnershipTransition {
  fromState: ControlOwner;
  toState: ControlOwner;
  actor: string;
  timestamp: string;
  reason?: string;
}

export class SessionCoordinator {
  private currentState: ControlOwner = "AUTOMATION_OWNED";
  private activeRequest: TakeoverRequest | null = null;
  private listener: EscalationListener | null = null;
  private ownershipTimeline: OwnershipTransition[] = [
    {
      fromState: "AUTOMATION_OWNED",
      toState: "AUTOMATION_OWNED",
      actor: "system",
      timestamp: new Date().toISOString(),
      reason: "Session initialized",
    },
  ];

  constructor(private surface: Surface) {}

  getState(): ControlOwner {
    return this.currentState;
  }

  getActiveRequest(): TakeoverRequest | null {
    return this.activeRequest;
  }

  getOwnershipTimeline(): OwnershipTransition[] {
    return [...this.ownershipTimeline];
  }

  setListener(listener: EscalationListener): void {
    this.listener = listener;
  }

  private transitionTo(newState: ControlOwner, actor: string, reason?: string): void {
    const fromState = this.currentState;
    this.currentState = newState;
    this.ownershipTimeline.push({
      fromState,
      toState: newState,
      actor,
      timestamp: new Date().toISOString(),
      reason,
    });
  }

  /**
   * Automation triggers an escalation request, transitioning to AWAITING_TAKEOVER
   */
  async requestEscalation(
    paramsOrReason: TakeoverRequest["reason"] | RequestEscalationParams,
    message?: string,
    stepId?: string,
    suggestedAction?: string,
    goal?: string,
    stepIndex?: number,
  ): Promise<TakeoverResolution> {
    if (this.currentState !== "AUTOMATION_OWNED") {
      throw new Error(`Cannot request escalation from state: ${this.currentState}`);
    }

    const params: RequestEscalationParams =
      typeof paramsOrReason === "object"
        ? paramsOrReason
        : {
            reason: paramsOrReason,
            message: message ?? "",
            stepId,
            suggestedAction,
            goal,
            stepIndex,
          };

    const snapshot = await this.surface.perceive().catch(() => undefined);
    const request: TakeoverRequest = {
      id: `esc_${Date.now()}`,
      goal: params.goal,
      stepId: params.stepId,
      stepIndex: params.stepIndex,
      reason: params.reason,
      message: params.message,
      currentUrl: snapshot?.url || "unknown",
      snapshot,
      suggestedAction: params.suggestedAction,
      timestamp: new Date().toISOString(),
    };

    this.activeRequest = request;
    this.transitionTo("AWAITING_TAKEOVER", "automation", params.reason);

    // Pause surface automation
    await this.surface.pauseForHuman(params.message);

    if (this.listener) {
      this.transitionTo("HUMAN_OWNED", "operator", "Operator accepted takeover request");
      const resolution = await this.listener.onRequest(request);
      return this.reclaimControl(resolution);
    }

    // Default resolution if no listener attached (e.g. automated test)
    this.transitionTo("AUTOMATION_OWNED", "system", "Auto-resolved (no active operator listener)");
    this.activeRequest = null;
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
    this.transitionTo(
      "HANDOFF_RECONCILIATION",
      resolution.resolvedBy,
      resolution.notes ?? "Operator initiated control transfer",
    );

    // Resume surface and verify state
    await this.surface.resumeFromHuman();

    this.transitionTo("AUTOMATION_OWNED", "automation", "Handoff reconciled, resuming automation");
    this.activeRequest = null;
    return resolution;
  }
}
