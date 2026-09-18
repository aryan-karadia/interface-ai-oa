import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";
import type {
  GuardrailPolicy,
  IGuardrailService,
  PreActionCheckResult,
} from "./guardrail.interface";
import { RiskClassifier } from "./risk-classifier";
import { Redactor } from "./redactor";

export class GuardrailService implements IGuardrailService {
  constructor(private policy: GuardrailPolicy) {}

  checkUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const isAllowed = this.policy.allowedDomains.some(
        (domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`)
      );
      if (!isAllowed) return false;

      if (this.policy.allowedPathPrefixes && this.policy.allowedPathPrefixes.length > 0) {
        return this.policy.allowedPathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
      }

      return true;
    } catch {
      // Non-parseable or relative URLs
      return false;
    }
  }

  checkAction(
    action: StepAction,
    currentUrl: string,
    targeting?: TargetingStrategy
  ): PreActionCheckResult {
    const riskLevel = RiskClassifier.classify(action, targeting);

    // 1. Navigation boundary check
    if (action.type === "navigate") {
      if (!this.checkUrl(action.url)) {
        return {
          allowed: false,
          riskLevel,
          violationCategory: "FORBIDDEN_DOMAIN",
          reason: `Navigation target "${action.url}" is not permitted by domain allowlist: [${this.policy.allowedDomains.join(", ")}]`,
        };
      }
    } else {
      // For any non-navigate action, verify we haven't somehow navigated to a forbidden origin
      if (currentUrl && currentUrl !== "about:blank" && !this.checkUrl(currentUrl)) {
        return {
          allowed: false,
          riskLevel,
          violationCategory: "FORBIDDEN_DOMAIN",
          reason: `Current session URL "${currentUrl}" is outside the permitted domain boundaries`,
        };
      }
    }

    // 2. High-risk irreversible action gate
    if (riskLevel === "HIGH_IRREVERSIBLE" && !this.policy.autoApproveHighRisk) {
      return {
        allowed: false,
        riskLevel,
        violationCategory: "HIGH_RISK_UNAUTHORIZED",
        reason: `Action is classified as HIGH_IRREVERSIBLE and requires human operator approval`,
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
    sensitiveKeys: Set<string>
  ): Record<string, unknown> {
    if (this.policy.redactionEnabled === false) return inputs;
    return Redactor.redactInputs(inputs, sensitiveKeys);
  }
}
