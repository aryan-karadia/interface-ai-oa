import { describe, expect, test } from "bun:test";
import { MockSurface } from "../../src/surface/mock-surface";
import { LocatorEngine } from "../../src/replay/locator-engine";

describe("LocatorEngine Multi-Tier Targeting & Fallbacks", () => {
  test("resolves element via Tier 1: Semantic (Role + Name)", async () => {
    const surface = new MockSurface();
    surface.setElement("btn_submit", {
      role: "button",
      name: "Submit Application",
      visible: true,
    });

    const target = await LocatorEngine.resolve(surface, {
      semantic: { role: "button", name: "Submit Application" },
    });

    expect(target).not.toBeNull();
    expect(target?.tier).toBe("semantic");
    expect(target?.element.name).toBe("Submit Application");
  });

  test("falls back to Tier 2: Anchor text when Tier 1 fails", async () => {
    const surface = new MockSurface();
    // Element has no semantic role/name, but has adjacent anchor text
    surface.setElement("input_8912", {
      tag: "input",
      text: "Member ID:",
      visible: true,
    });

    const target = await LocatorEngine.resolve(surface, {
      semantic: { role: "textbox", name: "Unused Semantic Name" }, // Will fail
      anchor: { anchorText: "Member ID:" },                        // Fallback will succeed
    });

    expect(target).not.toBeNull();
    expect(target?.tier).toBe("anchor");
    expect(target?.element.id).toBe("input_8912");
  });

  test("falls back to Tier 3: Structural selector when Tiers 1 and 2 fail", async () => {
    const surface = new MockSurface();
    surface.setElement("ctl00_MainContent_customGrid", {
      id: "ctl00_MainContent_customGrid",
      visible: true,
    });

    const target = await LocatorEngine.resolve(surface, {
      semantic: { role: "table" }, // Fails
      anchor: { anchorText: "Nonexistent Label" }, // Fails
      structural: { css: "ctl00_MainContent_customGrid" }, // Resolves
    });

    expect(target).not.toBeNull();
    expect(target?.tier).toBe("structural");
    expect(target?.element.id).toBe("ctl00_MainContent_customGrid");
  });

  test("falls back to Tier 4: Visual Bounding Box when all previous tiers fail", async () => {
    const surface = new MockSurface();
    surface.setElement("canvas_widget", {
      bounds: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
      visible: true,
    });

    const target = await LocatorEngine.resolve(surface, {
      structural: { css: "non_existent" },
      visualFallback: {
        normalizedBounds: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
      },
    });

    expect(target).not.toBeNull();
    expect(target?.tier).toBe("visualFallback");
  });
});
