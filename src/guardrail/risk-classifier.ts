import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";
import type { RiskLevel } from "./guardrail.interface";

const IRREVERSIBLE_KEYWORDS = [
  "delete",
  "remove",
  "drop",
  "terminate",
  "transfer",
  "wire",
  "purge",
  "destroy",
  "pay",
  "order",
  "checkout",
  "btn-danger",
  "danger",
  "reset-password",
  "revoke",
];

/**
 * Deterministically classifies action risk levels.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Static API is part of the public guardrail contract.
export class RiskClassifier {
  static classify(action: StepAction, targeting?: TargetingStrategy): RiskLevel {
    // Check if targeting mentions irreversible keywords
    if (targeting?.semantic?.name) {
      const lower = targeting.semantic.name.toLowerCase();
      if (IRREVERSIBLE_KEYWORDS.some((kw) => lower.includes(kw))) {
        return "HIGH_IRREVERSIBLE";
      }
    }

    if (targeting?.anchor?.anchorText) {
      const lower = targeting.anchor.anchorText.toLowerCase();
      if (IRREVERSIBLE_KEYWORDS.some((kw) => lower.includes(kw))) {
        return "HIGH_IRREVERSIBLE";
      }
    }

    if (targeting?.structural?.css) {
      const lower = targeting.structural.css.toLowerCase();
      if (IRREVERSIBLE_KEYWORDS.some((kw) => lower.includes(kw))) {
        return "HIGH_IRREVERSIBLE";
      }
    }

    if (targeting?.structural?.xpath) {
      const lower = targeting.structural.xpath.toLowerCase();
      if (IRREVERSIBLE_KEYWORDS.some((kw) => lower.includes(kw))) {
        return "HIGH_IRREVERSIBLE";
      }
    }

    // Action types
    switch (action.type) {
      case "click":
        return "MEDIUM"; // Standard click default
      case "fill":
      case "select":
      case "press":
        return "MEDIUM";
      case "navigate":
      case "wait":
      case "hover":
      case "scroll":
      case "extract":
        return "LOW";
      default:
        return "LOW";
    }
  }

  static isReversible(action: StepAction, targeting?: TargetingStrategy): boolean {
    const level = RiskClassifier.classify(action, targeting);
    return level !== "HIGH_IRREVERSIBLE";
  }

  static getRiskRationale(action: StepAction, targeting?: TargetingStrategy): string {
    const level = RiskClassifier.classify(action, targeting);
    if (level === "HIGH_IRREVERSIBLE") {
      return "Action targets a potentially destructive, financial, or irreversible endpoint that cannot be undone automatically.";
    }
    if (level === "MEDIUM") {
      return "Action modifies active DOM or session state but can be reversed or cleared without persistent database impact.";
    }
    return "Action is idempotent, read-only, or strictly non-destructive.";
  }
}
