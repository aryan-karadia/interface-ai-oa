import type { Surface, SurfaceElement } from "../surface/surface.interface";
import type { TargetingStrategy } from "../artifact/artifact.schema";

export interface ResolvedTarget {
  element: SurfaceElement;
  tier: "semantic" | "anchor" | "structural" | "visualFallback";
}

/**
 * Multi-tiered locator engine executing ordered fallback targeting:
 * Tier 1: Semantic (Role + Name / Accessibility)
 * Tier 2: Anchor text proximity
 * Tier 3: Structural (XPath / CSS)
 * Tier 4: Visual bounding box
 */
export class LocatorEngine {
  /**
   * Resolves a targeting strategy against a surface, walking through the fallback tiers in order.
   */
  static async resolve(
    surface: Surface,
    targeting: TargetingStrategy
  ): Promise<ResolvedTarget | null> {
    // 1. Try Semantic Tier
    if (targeting.semantic) {
      const el = await surface.locate({ semantic: targeting.semantic });
      if (el && (await el.isVisible())) {
        return { element: el, tier: "semantic" };
      }
    }

    // 2. Try Anchor Proximity Tier
    if (targeting.anchor) {
      const el = await surface.locate({ anchor: targeting.anchor });
      if (el && (await el.isVisible())) {
        return { element: el, tier: "anchor" };
      }
    }

    // 3. Try Structural Tier
    if (targeting.structural) {
      const el = await surface.locate({ structural: targeting.structural });
      if (el && (await el.isVisible())) {
        return { element: el, tier: "structural" };
      }
    }

    // 4. Try Visual Fallback Tier
    if (targeting.visualFallback) {
      const el = await surface.locate({ visualFallback: targeting.visualFallback });
      if (el) {
        return { element: el, tier: "visualFallback" };
      }
    }

    return null;
  }
}
