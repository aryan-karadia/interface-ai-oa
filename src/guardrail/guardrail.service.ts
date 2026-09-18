import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";
import type {
  GuardrailPolicy,
  IGuardrailService,
  PreActionCheckResult,
  SecurityAuditEntry,
} from "./guardrail.interface";
import { Redactor } from "./redactor";
import { RiskClassifier } from "./risk-classifier";

export class GuardrailService implements IGuardrailService {
  private auditLogs: SecurityAuditEntry[] = [];

  constructor(private policy: GuardrailPolicy) {}

  getAuditLogs(): SecurityAuditEntry[] {
    return [...this.auditLogs];
  }

  clearAuditLogs(): void {
    this.auditLogs = [];
  }

  private logAudit(entry: Omit<SecurityAuditEntry, "timestamp">): void {
    const fullEntry: SecurityAuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.push(fullEntry);
  }

  checkDomain(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return this.policy.allowedDomains.some(
        (domain) =>
          hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`),
      );
    } catch {
      return false;
    }
  }

  checkPath(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (this.policy.allowedPathPrefixes && this.policy.allowedPathPrefixes.length > 0) {
        return this.policy.allowedPathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
      }
      return true;
    } catch {
      return false;
    }
  }

  checkUrl(url: string): boolean {
    return this.checkDomain(url) && this.checkPath(url);
  }

  checkAction(
    action: StepAction,
    currentUrl: string,
    targeting?: TargetingStrategy,
  ): PreActionCheckResult {
    // 1. Action type allowlist check
    if (this.policy.allowedActionTypes && this.policy.allowedActionTypes.length > 0) {
      if (!this.policy.allowedActionTypes.includes(action.type)) {
        const reason = `Action type "${action.type}" is not permitted by allowedActionTypes allowlist: [${this.policy.allowedActionTypes.join(", ")}]`;
        this.logAudit({
          actionType: action.type,
          targetUrl: action.type === "navigate" ? action.url : currentUrl,
          violationCategory: "DISALLOWED_ACTION_TYPE",
          reason,
        });
        return {
          allowed: false,
          riskLevel: "HIGH_IRREVERSIBLE",
          violationCategory: "DISALLOWED_ACTION_TYPE",
          reason,
        };
      }
    }

    const riskLevel = RiskClassifier.classify(action, targeting);

    // 2. Navigation boundary check
    if (action.type === "navigate") {
      if (!this.checkDomain(action.url)) {
        const reason = `Navigation target "${action.url}" is not permitted by domain allowlist: [${this.policy.allowedDomains.join(", ")}]`;
        this.logAudit({
          actionType: action.type,
          targetUrl: action.url,
          violationCategory: "FORBIDDEN_DOMAIN",
          reason,
        });
        return {
          allowed: false,
          riskLevel,
          violationCategory: "FORBIDDEN_DOMAIN",
          reason,
        };
      }

      if (!this.checkPath(action.url)) {
        const reason = `Navigation target "${action.url}" is not permitted by route allowlist: [${this.policy.allowedPathPrefixes?.join(", ")}]`;
        this.logAudit({
          actionType: action.type,
          targetUrl: action.url,
          violationCategory: "FORBIDDEN_PATH",
          reason,
        });
        return {
          allowed: false,
          riskLevel,
          violationCategory: "FORBIDDEN_PATH",
          reason,
        };
      }
    } else {
      // For any non-navigate action, verify we haven't navigated to a forbidden domain or route
      if (currentUrl && currentUrl !== "about:blank") {
        if (!this.checkDomain(currentUrl)) {
          const reason = `Current session URL "${currentUrl}" is outside the permitted domain boundaries`;
          this.logAudit({
            actionType: action.type,
            targetUrl: currentUrl,
            violationCategory: "FORBIDDEN_DOMAIN",
            reason,
          });
          return {
            allowed: false,
            riskLevel,
            violationCategory: "FORBIDDEN_DOMAIN",
            reason,
          };
        }

        if (!this.checkPath(currentUrl)) {
          const reason = `Current session URL "${currentUrl}" is outside the permitted route boundaries: [${this.policy.allowedPathPrefixes?.join(", ")}]`;
          this.logAudit({
            actionType: action.type,
            targetUrl: currentUrl,
            violationCategory: "FORBIDDEN_PATH",
            reason,
          });
          return {
            allowed: false,
            riskLevel,
            violationCategory: "FORBIDDEN_PATH",
            reason,
          };
        }
      }
    }

    // 3. High-risk irreversible action gate
    if (riskLevel === "HIGH_IRREVERSIBLE") {
      const mode =
        this.policy.highRiskPolicy ?? (this.policy.autoApproveHighRisk ? "FLAG" : "BLOCK");

      if (mode === "FLAG") {
        this.logAudit({
          actionType: action.type,
          targetUrl: action.type === "navigate" ? action.url : currentUrl,
          violationCategory: "HIGH_RISK_UNAUTHORIZED",
          reason: "Action is classified as HIGH_IRREVERSIBLE and executed under audited mode",
        });
        return { allowed: true, riskLevel };
      }

      if (mode === "CONFIRM") {
        let approved = false;
        if (this.policy.operatorConfirmCallback) {
          const res = this.policy.operatorConfirmCallback(action, targeting);
          approved = res instanceof Promise ? false : Boolean(res);
        }

        if (approved) {
          return { allowed: true, riskLevel };
        }

        const reason =
          "Action classified as HIGH_IRREVERSIBLE was denied by operator confirmation policy";
        this.logAudit({
          actionType: action.type,
          targetUrl: action.type === "navigate" ? action.url : currentUrl,
          violationCategory: "HIGH_RISK_UNAUTHORIZED",
          reason,
        });
        return {
          allowed: false,
          riskLevel,
          violationCategory: "HIGH_RISK_UNAUTHORIZED",
          reason,
        };
      }

      // Default: BLOCK mode
      const reason = "Action is classified as HIGH_IRREVERSIBLE and blocked by conservative policy";
      this.logAudit({
        actionType: action.type,
        targetUrl: action.type === "navigate" ? action.url : currentUrl,
        violationCategory: "HIGH_RISK_UNAUTHORIZED",
        reason,
      });
      return {
        allowed: false,
        riskLevel,
        violationCategory: "HIGH_RISK_UNAUTHORIZED",
        reason,
      };
    }

    return { allowed: true, riskLevel };
  }

  redactText(text: string): string {
    if (this.policy.redactionEnabled === false) return text;
    return Redactor.redact(text);
  }

  redactInputs(
    inputs: Record<string, unknown>,
    sensitiveKeys: Set<string>,
  ): Record<string, unknown> {
    if (this.policy.redactionEnabled === false) return inputs;
    return Redactor.redactInputs(inputs, sensitiveKeys);
  }
}
