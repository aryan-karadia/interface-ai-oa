import type { SurfaceSnapshot } from "../surface/surface.interface";

export type ControlOwner =
  | "AUTOMATION_OWNED"
  | "AWAITING_TAKEOVER"
  | "HUMAN_OWNED"
  | "HANDOFF_RECONCILIATION";

export type EscalationReason =
  | "TARGETING_EXHAUSTED"
  | "DEAD_END_DETECTED"
  | "HIGH_RISK_ACTION_CONFIRMATION"
  | "CAPTCHA_OR_2FA_DETECTED"
  | "RECOVERY_RETRIES_EXCEEDED"
  | "GUARDRAIL_BLOCKED"
  | "UNEXPECTED_STATE";

export interface TakeoverRequest {
  id: string;
  goal?: string;
  stepId?: string;
  stepIndex?: number;
  reason: EscalationReason;
  message: string;
  currentUrl: string;
  snapshot?: SurfaceSnapshot;
  suggestedAction?: string;
  timestamp: string;
}

export interface TakeoverResolution {
  requestId: string;
  resolvedBy: "operator" | "timeout" | "cancelled";
  notes?: string;
  resumedAt: string;
}

export interface EscalationListener {
  onRequest(request: TakeoverRequest): Promise<TakeoverResolution>;
}
