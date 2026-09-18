import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";

describe("T1.1: Repo Scaffold & ADR Process", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const adrDir = resolve(rootDir, "docs/adr");

  test("ADR-000-template.md exists and contains standard ADR sections", () => {
    const templatePath = resolve(adrDir, "ADR-000-template.md");
    expect(existsSync(templatePath)).toBe(true);

    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Status");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");
  });

  test("all ADR files follow the standard template sections", () => {
    const adrFiles = readdirSync(adrDir).filter((f) => f.endsWith(".md"));
    expect(adrFiles.length).toBeGreaterThanOrEqual(8); // Template + 7 ADRs

    for (const file of adrFiles) {
      const content = readFileSync(resolve(adrDir, file), "utf-8");
      expect(content).toContain("## Status");
      expect(content).toContain("## Context");
      expect(content).toContain("## Decision");
      expect(content).toContain("## Consequences");
    }
  });

  test("package.json defines build, test, lint, and format scripts", () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.lint).toBeDefined();
    expect(pkg.scripts.format).toBeDefined();
  });
});
