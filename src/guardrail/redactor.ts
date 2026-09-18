/**
 * Regex-based PII and secret redaction engine.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Static API is part of the public guardrail contract.
export class Redactor {
  private static SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  private static CREDIT_CARD_REGEX = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;
  private static API_KEY_REGEX =
    /\b(?:sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|Bearer\s+[a-zA-Z0-9._-]+)\b/g;
  private static EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  private static PHONE_REGEX =
    /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g;

  /**
   * Scrubs known PII patterns from raw text or logs.
   */
  static redact(text: string): string {
    if (!text) return text;
    return text
      .replace(Redactor.SSN_REGEX, "[REDACTED_SSN]")
      .replace(Redactor.CREDIT_CARD_REGEX, "[REDACTED_CREDIT_CARD]")
      .replace(Redactor.API_KEY_REGEX, "[REDACTED_SECRET]")
      .replace(Redactor.EMAIL_REGEX, "[REDACTED_EMAIL]")
      .replace(Redactor.PHONE_REGEX, "[REDACTED_PHONE]");
  }

  /**
   * Deeply sanitizes nested objects, arrays, and primitives.
   */
  static redactDeep<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string") {
      return Redactor.redact(value) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => Redactor.redactDeep(item)) as unknown as T;
    }
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      const sensitiveKeyPattern = /password|secret|token|apikey|api_key|credential|private_key/i;

      for (const [key, val] of Object.entries(value)) {
        if (sensitiveKeyPattern.test(key) && typeof val === "string") {
          result[key] = "[REDACTED_SECRET]";
        } else {
          result[key] = Redactor.redactDeep(val);
        }
      }
      return result as unknown as T;
    }
    return value;
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
        masked[key] = Redactor.redactDeep(value);
      }
    }
    return masked;
  }
}
