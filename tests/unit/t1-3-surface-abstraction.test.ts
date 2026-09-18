import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Surface } from "../../src/surface/surface.interface";
import { MockSurface } from "../../src/surface/mock-surface";
import { PlaywrightSurface } from "../../src/surface/playwright-surface";

describe("T1.3: Surface Abstraction Interface & Decoupling", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const adr0002Path = resolve(rootDir, "docs/adr/0002-architectural-boundaries-and-seams.md");

  test("ADR-0002 documents the Surface abstraction and defends the seam", () => {
    const adrContent = readFileSync(adr0002Path, "utf-8");
    expect(adrContent).toContain("Boundary 1: Surface Abstraction");
    expect(adrContent).toContain("perceive()");
    expect(adrContent).toContain("act(");
    expect(adrContent).toContain("What would break if Replay depended directly on Playwright");
  });

  test("PlaywrightSurface and MockSurface both satisfy the polymorphic Surface contract", () => {
    const mock: Surface = new MockSurface();
    const playwright: Surface = new PlaywrightSurface({ headless: true });

    const requiredMethods: Array<keyof Surface> = [
      "initialize",
      "close",
      "perceive",
      "navigate",
      "locate",
      "act",
      "evaluateAssertion",
      "dismissOverlays",
      "pauseForHuman",
      "resumeFromHuman",
      "wait",
    ];

    for (const method of requiredMethods) {
      expect(typeof mock[method]).toBe("function");
      expect(typeof playwright[method]).toBe("function");
    }
  });

  test("a generic client can interact with Surface without knowing underlying driver", async () => {
    async function runGenericPerception(surface: Surface) {
      await surface.initialize();
      const snap = await surface.perceive();
      await surface.close();
      return snap;
    }

    const mock = new MockSurface();
    mock.title = "Polymorphic Test";
    const snapshot = await runGenericPerception(mock);
    expect(snapshot.title).toBe("Polymorphic Test");
    expect(snapshot.accessibilityTree).toBeDefined();
  });
});
