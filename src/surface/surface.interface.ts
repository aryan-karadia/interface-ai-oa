import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";

/**
 * Normalized Accessibility Node representation
 */
export interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children?: AccessibilityNode[];
  rawSelector?: string;
  tag?: string;
  attributes?: Record<string, string>;
}

/**
 * Complete perceived state of a surface at an instant
 */
export interface SurfaceSnapshot {
  url: string;
  title: string;
  accessibilityTree: AccessibilityNode;
  activeElementRole?: string;
  visibleText: string;
  screenshotBase64?: string;
  timestamp: string;
}

/**
 * Handle to an element resolved on the surface
 */
export interface SurfaceElement {
  id: string;
  role?: string;
  name?: string;
  tag?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  click(button?: "left" | "right" | "middle"): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  select(value: string): Promise<void>;
  hover(): Promise<void>;
  getText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
}

export interface ActionResult {
  success: boolean;
  actionType: string;
  durationMs: number;
  error?: string;
  targetingTierUsed?: "semantic" | "anchor" | "structural" | "visualFallback";
}

/**
 * Core Surface Abstraction
 * Completely decouples the Replay and Discovery engines from concrete automation drivers (Playwright, Puppeteer, OS).
 */
export interface Surface {
  /**
   * Initializes the surface connection (e.g. browser launch, page creation)
   */
  initialize(): Promise<void>;

  /**
   * Closes the surface connection
   */
  close(): Promise<void>;

  /**
   * Captures the current perception snapshot
   */
  perceive(): Promise<SurfaceSnapshot>;

  /**
   * Navigates to a specific URL
   */
  navigate(url: string): Promise<void>;

  /**
   * Locates an element using a multi-tiered targeting strategy
   */
  locate(targeting: TargetingStrategy): Promise<SurfaceElement | null>;

  /**
   * Executes a high-level step action on the surface
   */
  act(action: StepAction, targeting?: TargetingStrategy): Promise<ActionResult>;

  /**
   * Evaluates if an assertion holds true on the current surface
   */
  evaluateAssertion(
    type: "element_visible" | "text_contains" | "url_matches",
    expectedValue?: string,
    targeting?: TargetingStrategy
  ): Promise<boolean>;

  /**
   * Checks for any occluding overlays / modals and attempts to dismiss them
   */
  dismissOverlays(): Promise<boolean>;

  /**
   * Pauses automation for human operator intervention
   */
  pauseForHuman(reason: string): Promise<void>;

  /**
   * Resumes automation from human operator intervention
   */
  resumeFromHuman(): Promise<SurfaceSnapshot>;

  /**
   * Waits for a duration in milliseconds
   */
  wait(ms: number): Promise<void>;
}
