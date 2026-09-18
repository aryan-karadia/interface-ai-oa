import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("T6.4: /README.md Verification & Usability Contract", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const readmePath = resolve(rootDir, "README.md");

  test("README.md exists and is non-empty", () => {
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf-8");
    expect(content.length).toBeGreaterThanOrEqual(1000);
  });

  test("README.md contains setup and configuration instructions (including offline mode)", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("bun install");
    expect(content).toContain("GEMINI_API_KEY");
    expect(content).toContain("--mock");
  });

  test("README.md documents the exact demo command sequence", () => {
    const content = readFileSync(readmePath, "utf-8");
    // Discovery
    expect(content).toContain("discover");
    // Inspect
    expect(content).toContain("inspect");
    // Replay
    expect(content).toContain("replay");
    // Tests
    expect(content).toContain("bun test");
  });

  test("README.md documents evidence deliverables and report links", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("REPORT.md");
    expect(content).toContain("evidence");
    expect(content).toContain("artifacts");
  });
});
