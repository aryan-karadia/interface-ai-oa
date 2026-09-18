import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH_IRREVERSIBLE";

export interface GuardrailPolicy {
  allowedDomains: string[];
  allowedPathPrefixes?: string[];
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
  redactText(text: string): string;
  redactInputs(
    inputs: Record<string, unknown>,
    sensitiveKeys: Set<string>,
  ): Record<string, unknown>;
}
