import type {
  Surface,
  SurfaceSnapshot,
  SurfaceElement,
  ActionResult,
  AccessibilityNode,
} from "./surface.interface";
import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";

export interface MockElementState {
  id: string;
  role?: string;
  name?: string;
  tag?: string;
  text?: string;
  value?: string;
  visible?: boolean;
  attributes?: Record<string, string>;
  bounds?: { x: number; y: number; width: number; height: number };
}

export class MockSurfaceElement implements SurfaceElement {
  constructor(public state: MockElementState) {
    this.id = state.id;
    this.role = state.role;
    this.name = state.name;
    this.tag = state.tag;
    this.bounds = state.bounds;
  }

  id: string;
  role?: string;
  name?: string;
  tag?: string;
  bounds?: { x: number; y: number; width: number; height: number };

  async click(_button: "left" | "right" | "middle" = "left"): Promise<void> {
    // Recorded in mock state
  }

  async fill(value: string): Promise<void> {
    this.state.value = value;
  }

  async press(_key: string): Promise<void> {
    // Recorded in mock state
  }

  async select(value: string): Promise<void> {
    this.state.value = value;
  }

  async hover(): Promise<void> {
    // Recorded in mock state
  }

  async getText(): Promise<string> {
    return this.state.text ?? this.state.value ?? "";
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.state.attributes?.[name] ?? null;
  }

  async isVisible(): Promise<boolean> {
    return this.state.visible ?? true;
  }
}

/**
 * In-memory MockSurface implementing the complete Surface interface.
 * Allows fast, headless, zero-dependency testing of all replay workflows.
 */
export class MockSurface implements Surface {
  public url: string = "about:blank";
  public title: string = "Mock Page";
  public elements: Map<string, MockElementState> = new Map();
  public overlayActive: boolean = false;
  public actionsLog: Array<{ action: StepAction; targeting?: TargetingStrategy }> = [];
  public humanPauseActive: boolean = false;
  public pauseReason?: string;

  async initialize(): Promise<void> {
    // No-op for in-memory mock
  }

  async close(): Promise<void> {
    // No-op for in-memory mock
  }

  setElement(id: string, state: Partial<MockElementState>): void {
    const existing = this.elements.get(id) ?? { id };
    this.elements.set(id, { ...existing, ...state });
  }

  removeElement(id: string): void {
    this.elements.delete(id);
  }

  async perceive(): Promise<SurfaceSnapshot> {
    const rootChildren: AccessibilityNode[] = [];
    let aggregatedText = "";

    for (const el of this.elements.values()) {
      if (el.visible !== false) {
        rootChildren.push({
          role: el.role ?? "generic",
          name: el.name,
          value: el.value,
          bounds: el.bounds,
          tag: el.tag,
        });
        if (el.text) aggregatedText += ` ${el.text}`;
      }
    }

    return {
      url: this.url,
      title: this.title,
      accessibilityTree: {
        role: "WebArea",
        name: this.title,
        children: rootChildren,
      },
      visibleText: aggregatedText.trim(),
      timestamp: new Date().toISOString(),
    };
  }

  async navigate(url: string): Promise<void> {
    this.url = url;
  }

  async locate(targeting: TargetingStrategy): Promise<SurfaceElement | null> {
    if (this.overlayActive) {
      return null; // Occluded
    }

    // Tier 1: Semantic (Role & Name)
    if (targeting.semantic) {
      const { role, name, exact } = targeting.semantic;
      for (const el of this.elements.values()) {
        if (el.visible === false) continue;
        const roleMatches = !role || el.role?.toLowerCase() === role.toLowerCase();
        const nameMatches =
          !name ||
          (exact
            ? el.name === name
            : el.name?.toLowerCase().includes(name.toLowerCase()));
        if (roleMatches && nameMatches) {
          return new MockSurfaceElement(el);
        }
      }
    }

    // Tier 2: Anchor Proximity
    if (targeting.anchor) {
      const { anchorText } = targeting.anchor;
      for (const el of this.elements.values()) {
        if (el.visible === false) continue;
        if (el.text?.includes(anchorText) || el.name?.includes(anchorText)) {
          // If anchor text matches this element or neighbor
          return new MockSurfaceElement(el);
        }
      }
    }

    // Tier 3: Structural
    if (targeting.structural?.css || targeting.structural?.xpath) {
      const targetQuery = targeting.structural.css || targeting.structural.xpath;
      for (const el of this.elements.values()) {
        if (el.id === targetQuery || el.attributes?.["data-testid"] === targetQuery) {
          return new MockSurfaceElement(el);
        }
      }
    }

    // Tier 4: Visual Fallback
    if (targeting.visualFallback?.normalizedBounds) {
      const bounds = targeting.visualFallback.normalizedBounds;
      for (const el of this.elements.values()) {
        if (
          el.bounds &&
          Math.abs(el.bounds.x - bounds.x) < 0.05 &&
          Math.abs(el.bounds.y - bounds.y) < 0.05
        ) {
          return new MockSurfaceElement(el);
        }
      }
    }

    return null;
  }

  async act(action: StepAction, targeting?: TargetingStrategy): Promise<ActionResult> {
    const startTime = Date.now();
    this.actionsLog.push({ action, targeting });

    if (action.type === "navigate") {
      this.url = action.url;
      return { success: true, actionType: "navigate", durationMs: Date.now() - startTime };
    }

    if (action.type === "wait") {
      return { success: true, actionType: "wait", durationMs: 5 };
    }

    if (targeting) {
      const el = await this.locate(targeting);
      if (!el) {
        return {
          success: false,
          actionType: action.type,
          durationMs: Date.now() - startTime,
          error: "Element not found through targeting strategy",
        };
      }

      if (action.type === "click") {
        await el.click(action.button);
      } else if (action.type === "fill") {
        await el.fill(action.valueTemplate);
      } else if (action.type === "press") {
        await el.press(action.key);
      } else if (action.type === "select") {
        await el.select(action.value);
      } else if (action.type === "hover") {
        await el.hover();
      }

      return {
        success: true,
        actionType: action.type,
        durationMs: Date.now() - startTime,
        targetingTierUsed: "semantic",
      };
    }

    return { success: true, actionType: action.type, durationMs: Date.now() - startTime };
  }

  async evaluateAssertion(
    type: "element_visible" | "text_contains" | "url_matches",
    expectedValue?: string,
    targeting?: TargetingStrategy
  ): Promise<boolean> {
    if (type === "url_matches") {
      return expectedValue ? this.url.includes(expectedValue) : false;
    }

    if (type === "text_contains") {
      const snap = await this.perceive();
      return expectedValue ? snap.visibleText.includes(expectedValue) : false;
    }

    if (type === "element_visible" && targeting) {
      const el = await this.locate(targeting);
      return el !== null && (await el.isVisible());
    }

    return false;
  }

  async dismissOverlays(): Promise<boolean> {
    if (this.overlayActive) {
      this.overlayActive = false;
      return true;
    }
    return false;
  }

  async pauseForHuman(reason: string): Promise<void> {
    this.humanPauseActive = true;
    this.pauseReason = reason;
  }

  async resumeFromHuman(): Promise<SurfaceSnapshot> {
    this.humanPauseActive = false;
    return this.perceive();
  }

  async wait(_ms: number): Promise<void> {
    // Fast simulated wait
  }
}
