import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  exampleBusinessOutcomeResult,
  exampleHardFailureResult,
  exampleRecoverableResult,
  exampleSuccessResult,
  validateReplayResult,
} from "../../src/replay/result-contract";

describe("T3.3: Result Contract & Error Taxonomy (ADR-003)", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const adrPath = resolve(rootDir, "docs/adr/ADR-003-result-contract-and-error-taxonomy.md");

  test("ADR-003 exists and thoroughly defends the three outcome classes", () => {
    expect(existsSync(adrPath)).toBe(true);
    const content = readFileSync(adrPath, "utf-8");

    expect(content).toContain("## Status");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");

    // Defends the three non-success outcome classes
    expect(content).toContain("BUSINESS_OUTCOME");
    expect(content).toContain("RECOVERABLE_RUNTIME_CONDITION");
    expect(content).toContain("HARD_FAILURE");

    // Concrete rationale
    expect(content).toContain("MEMBER_NOT_FOUND");
    expect(content).toContain("ELEMENT_OCCLUDED");
    expect(content).toContain("GUARDRAIL_VIOLATION");
  });

  test("schema validates concrete example of SUCCESS", () => {
    expect(exampleSuccessResult).toBeDefined();
    expect(exampleSuccessResult.status).toBe("SUCCESS");
    const report = validateReplayResult(exampleSuccessResult);
    expect(report.valid).toBe(true);
    expect(report.result?.status).toBe("SUCCESS");
  });

  test("schema validates concrete example of BUSINESS_OUTCOME (e.g. member not found)", () => {
    expect(exampleBusinessOutcomeResult).toBeDefined();
    expect(exampleBusinessOutcomeResult.status).toBe("BUSINESS_OUTCOME");
    expect(exampleBusinessOutcomeResult.outcomeCode).toBe("MEMBER_NOT_FOUND");
    const report = validateReplayResult(exampleBusinessOutcomeResult);
    expect(report.valid).toBe(true);
    expect(report.result?.status).toBe("BUSINESS_OUTCOME");
  });

  test("schema validates concrete example of RECOVERABLE_RUNTIME_CONDITION (e.g. modal occlusion)", () => {
    expect(exampleRecoverableResult).toBeDefined();
    expect(exampleRecoverableResult.status).toBe("RECOVERABLE_RUNTIME_CONDITION");
    expect(exampleRecoverableResult.suggestedAction).toBe("DISMISS_OVERLAY_AND_RETRY");
    const report = validateReplayResult(exampleRecoverableResult);
    expect(report.valid).toBe(true);
    expect(report.result?.status).toBe("RECOVERABLE_RUNTIME_CONDITION");
  });

  test("schema validates concrete example of HARD_FAILURE (e.g. guardrail violation)", () => {
    expect(exampleHardFailureResult).toBeDefined();
    expect(exampleHardFailureResult.status).toBe("HARD_FAILURE");
    expect(exampleHardFailureResult.category).toBe("GUARDRAIL_VIOLATION");
    const report = validateReplayResult(exampleHardFailureResult);
    expect(report.valid).toBe(true);
    expect(report.result?.status).toBe("HARD_FAILURE");
  });

  test("schema rejects invalid results missing mandatory telemetry or discriminator", () => {
    const invalidMissingStatus = {
      artifactId: "test.id",
      executionDurationMs: 100,
    };
    const report = validateReplayResult(invalidMissingStatus);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});
