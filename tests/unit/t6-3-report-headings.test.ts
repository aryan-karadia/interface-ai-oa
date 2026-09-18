import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("T6.3: /REPORT.md Headings & Structure Validation", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const reportPath = resolve(rootDir, "REPORT.md");

  test("REPORT.md exists and contains the 7 required Section 6 headings", () => {
    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, "utf-8");

    // The 7 exact headings from Section 6:
    // 1. Architecture
    // 2. Artifact schema
    // 3. Determinism & error handling
    // 4. Heterogeneity & multi-tenant
    // 5. Escalation & handoff
    // 6. Safety
    // 7. Cuts
    const requiredHeadings = [
      "Architecture",
      "Artifact schema",
      "Determinism & error handling",
      "Heterogeneity & multi-tenant",
      "Escalation & handoff",
      "Safety",
      "Cuts",
    ];

    for (const heading of requiredHeadings) {
      const headingRegex = new RegExp(`##\\s+(\\d+\\.\\s+)?${heading}`, "i");
      expect(content).toMatch(headingRegex);
    }
  });

  test("REPORT.md maintains backward compatibility with locator robustness test requirements", () => {
    const content = readFileSync(reportPath, "utf-8");
    expect(content).toContain("3. Locator & Targeting Robustness Strategy");
    expect(content).toContain("Tier 1: Semantic");
    expect(content).toContain("Tier 2: Anchor");
    expect(content).toContain("Tier 3: Structural");
    expect(content).toContain("Tier 4: Visual");
    expect(content).toContain("Fallback Path Exercised");
  });

  test("REPORT.md provides comprehensive coverage across system design and evaluation criteria", () => {
    const content = readFileSync(reportPath, "utf-8");
    // Ensure sufficient depth (~1-3 pages, at least 1500 words / 8000 bytes)
    expect(content.length).toBeGreaterThanOrEqual(8000);

    // Verify key architectural references
    expect(content).toContain("Surface");
    expect(content).toContain("ADR-002");
    expect(content).toContain("ADR-003");
    expect(content).toContain("ADR-004");
    expect(content).toContain("ADR-005");
    expect(content).toContain("Redactor");
    expect(content).toContain("SessionCoordinator");
  });
});
