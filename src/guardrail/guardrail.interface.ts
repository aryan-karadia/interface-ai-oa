import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH_IRREVERSIBLE";

export interface SecurityAuditEntry {
  timestamp: string;
  actionType: string;
  targetUrl?: string;
  violationCategory:
    | "FORBIDDEN_DOMAIN"
    | "FORBIDDEN_PATH"
    | "DISALLOWED_ACTION_TYPE"
    | "HIGH_RISK_UNAUTHORIZED"
    | "MALFORMED_URL";
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface GuardrailPolicy {
  allowedDomains: string[];
  allowedPathPrefixes?: string[];
  allowedActionTypes?: string[];
  autoApproveHighRisk?: boolean;
  redactionEnabled?: boolean;
  riskThreshold?: RiskLevel;
}

export interface PreActionCheckResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  violationCategory?:
    | "FORBIDDEN_DOMAIN"
    | "FORBIDDEN_PATH"
    | "DISALLOWED_ACTION_TYPE"
    | "HIGH_RISK_UNAUTHORIZED"
    | "MALFORMED_URL";
  reason?: string;
}

export interface IGuardrailService {
  checkAction(
    action: StepAction,
    currentUrl: string,
    targeting?: TargetingStrategy,
  ): PreActionCheckResult;
  checkUrl(url: string): boolean;
  checkPath(url: string): boolean;
  getAuditLogs(): SecurityAuditEntry[];
  clearAuditLogs(): void;
  redactText(text: string): string;
  redactInputs(
    inputs: Record<string, unknown>,
    sensitiveKeys: Set<string>,
  ): Record<string, unknown>;
}
