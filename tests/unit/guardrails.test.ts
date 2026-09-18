import { describe, expect, test } from "bun:test";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { RiskClassifier } from "../../src/guardrail/risk-classifier";
import { Redactor } from "../../src/guardrail/redactor";

describe("Guardrails & Policy Enforcement", () => {
  const guardrail = new GuardrailService({
    allowedDomains: ["localhost", "internal.acme.corp"],
    autoApproveHighRisk: false,
    redactionEnabled: true,
  });

  test("allows navigation to whitelisted domain", () => {
    const result = guardrail.checkAction(
      { type: "navigate", url: "http://localhost:3000/portal" },
      "http://localhost:3000"
    );
    expect(result.allowed).toBe(true);
  });

  test("blocks navigation to forbidden external domain", () => {
    const result = guardrail.checkAction(
      { type: "navigate", url: "https://malicious-external-site.com/phish" },
      "http://localhost:3000"
    );
    expect(result.allowed).toBe(false);
    expect(result.violationCategory).toBe("FORBIDDEN_DOMAIN");
  });

  test("classifies irreversible actions as HIGH_IRREVERSIBLE", () => {
    const risk = RiskClassifier.classify(
      { type: "click" },
      { semantic: { name: "Purge Database Records" } }
    );
    expect(risk).toBe("HIGH_IRREVERSIBLE");
  });

  test("blocks unauthorized HIGH_IRREVERSIBLE action without operator approval", () => {
    const result = guardrail.checkAction(
      { type: "click" },
      "http://localhost:3000",
      { semantic: { name: "Delete Member Account" } }
    );
    expect(result.allowed).toBe(false);
    expect(result.violationCategory).toBe("HIGH_RISK_UNAUTHORIZED");
  });

  test("redacts sensitive PII (SSN and Credit Cards) from text", () => {
    const rawText = "User SSN is 123-45-6789 and Card is 4111-2222-3333-4444.";
    const cleaned = Redactor.redact(rawText);
    expect(cleaned).not.toContain("123-45-6789");
    expect(cleaned).not.toContain("4111-2222-3333-4444");
    expect(cleaned).toContain("[REDACTED_SSN]");
    expect(cleaned).toContain("[REDACTED_CREDIT_CARD]");
  });

  test("masks inputs defined as sensitive", () => {
    const inputs = {
      memberId: "10042",
      password: "SuperSecretPassword123!",
    };
    const sensitiveKeys = new Set(["password"]);
    const masked = Redactor.redactInputs(inputs, sensitiveKeys);
    expect(masked.memberId).toBe("10042");
    expect(masked.password).toBe("[REDACTED]");
  });
});
