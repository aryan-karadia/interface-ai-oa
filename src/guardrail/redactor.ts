/**
 * Regex-based PII and secret redaction engine.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Static API is part of the public guardrail contract.
export class Redactor {
  private static SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  private static CREDIT_CARD_REGEX = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;
  private static API_KEY_REGEX = /\b(?:sk-[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9._-]+)\b/g;

  /**
   * Scrubs known PII patterns from raw text or logs.
   */
  static redact(text: string): string {
    if (!text) return text;
    return text
      .replace(Redactor.SSN_REGEX, "[REDACTED_SSN]")
      .replace(Redactor.CREDIT_CARD_REGEX, "[REDACTED_CREDIT_CARD]")
      .replace(Redactor.API_KEY_REGEX, "[REDACTED_SECRET]");
  }

  /**
   * Masks input parameters marked as sensitive.
   */
  static redactInputs(
    inputs: Record<string, unknown>,
    sensitiveKeys: Set<string>,
  ): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (sensitiveKeys.has(key)) {
        masked[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        masked[key] = Redactor.redact(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
}
