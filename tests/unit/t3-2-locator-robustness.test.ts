import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { TargetingStrategy } from "../../src/artifact/artifact.schema";
import { LocatorEngine } from "../../src/replay/locator-engine";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T3.2: Locator/Targeting Robustness Strategy", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const reportPath = resolve(rootDir, "REPORT.md");

  test("REPORT.md exists and contains Section 3 defending targeting strategy", () => {
    expect(existsSync(reportPath)).toBe(true);
    const reportContent = readFileSync(reportPath, "utf-8");

    expect(reportContent).toContain("3. Locator & Targeting Robustness Strategy");
    expect(reportContent).toContain("Tier 1: Semantic");
    expect(reportContent).toContain("Tier 2: Anchor");
    expect(reportContent).toContain("Tier 3: Structural");
    expect(reportContent).toContain("Tier 4: Visual");
    expect(reportContent).toContain("Fallback Path Exercised");
  });

  test("exercises fallback path from Tier 1 to Tier 2 (Anchor Text) when semantic role fails", async () => {
    const surface = new MockSurface();
    // Element has no semantic role or accessible name, but has anchor text nearby
    surface.setElement("txt_legacy_member", {
      text: "Member ID:",
      value: "",
      visible: true,
      // Intentionally unsemantic: no role, no accessible name
    });

    const targeting: TargetingStrategy = {
      semantic: { role: "textbox", name: "NonExistentName" }, // Will FAIL
      anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" }, // Will SUCCEED
      structural: { css: "#ctl00_legacy_box_99" },
    };

    const resolved = await LocatorEngine.resolve(surface, targeting);
    expect(resolved).not.toBeNull();
    expect(resolved?.tier).toBe("anchor");
    expect(resolved?.element).toBeDefined();
  });

  test("exercises fallback path from Tier 2 to Tier 3 (Structural) when semantic and anchor fail", async () => {
    const surface = new MockSurface();
    surface.setElement("raw_table_cell", {
      id: "ctl00_grid_cell_0_2",
      visible: true,
    });

    const targeting: TargetingStrategy = {
      semantic: { role: "cell", name: "WrongCell" }, // Tier 1 FAILS
      anchor: { anchorText: "NonExistentLabel" }, // Tier 2 FAILS
      structural: { css: "#ctl00_grid_cell_0_2" }, // Tier 3 SUCCEEDS
    };

    const resolved = await LocatorEngine.resolve(surface, targeting);
    expect(resolved).not.toBeNull();
    expect(resolved?.tier).toBe("structural");
  });

  test("exercises fallback path from Tier 3 to Tier 4 (Visual Fallback) when all DOM tiers fail", async () => {
    const surface = new MockSurface();
    surface.setElement("canvas_or_custom_button", {
      bounds: { x: 0.5, y: 0.5, width: 0.1, height: 0.05 },
      visible: true,
    });

    const targeting: TargetingStrategy = {
      semantic: { role: "button", name: "Submit" }, // Tier 1 FAILS
      anchor: { anchorText: "Submit Claim" }, // Tier 2 FAILS
      structural: { css: "#ctl00_broken_id" }, // Tier 3 FAILS
      visualFallback: {
        normalizedBounds: { x: 0.5, y: 0.5, width: 0.1, height: 0.05 },
      }, // Tier 4 SUCCEEDS
    };

    const resolved = await LocatorEngine.resolve(surface, targeting);
    expect(resolved).not.toBeNull();
    expect(resolved?.tier).toBe("visualFallback");
  });

  test("survives dynamic ASP.NET ID hash regeneration via anchor text fallback", async () => {
    const surface = new MockSurface();
    // Simulate server deploy that changed ID from ctl00_btnSearch_329a to ctl00_btnSearch_887b
    surface.setElement("search_button_rehashed", {
      id: "ctl00_btnSearch_887b",
      text: "Search",
      role: "button",
      name: "Search",
      visible: true,
    });

    // Stored artifact had old hash in structural selector, but robust anchor/semantic targeting
    const legacyTargeting: TargetingStrategy = {
      structural: { css: "#ctl00_btnSearch_329a" }, // Stale ID from prior build (FAILS)
      semantic: { role: "button", name: "Search" }, // SUCCEEDS
      anchor: { anchorText: "Search" },
    };

    const resolved = await LocatorEngine.resolve(surface, legacyTargeting);
    expect(resolved).not.toBeNull();
    expect(resolved?.tier).toBe("semantic");
    expect(await resolved?.element.isVisible()).toBe(true);
  });
});
