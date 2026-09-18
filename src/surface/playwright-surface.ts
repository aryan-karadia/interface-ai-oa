import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright";
import type {
  Surface,
  SurfaceSnapshot,
  SurfaceElement,
  ActionResult,
  AccessibilityNode,
} from "./surface.interface";
import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";

export class PlaywrightElementHandle implements SurfaceElement {
  constructor(public id: string, private locator: Locator) {}

  role?: string;
  name?: string;
  tag?: string;

  async click(button: "left" | "right" | "middle" = "left"): Promise<void> {
    await this.locator.click({ button, timeout: 5000 });
  }

  async fill(value: string): Promise<void> {
    await this.locator.fill(value, { timeout: 5000 });
  }

  async press(key: string): Promise<void> {
    await this.locator.press(key, { timeout: 5000 });
  }

  async select(value: string): Promise<void> {
    await this.locator.selectOption(value, { timeout: 5000 });
  }

  async hover(): Promise<void> {
    await this.locator.hover({ timeout: 5000 });
  }

  async getText(): Promise<string> {
    const text = await this.locator.innerText({ timeout: 2000 }).catch(() => "");
    if (text) return text;
    return (await this.locator.inputValue({ timeout: 2000 }).catch(() => "")) ?? "";
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.locator.getAttribute(name, { timeout: 2000 }).catch(() => null);
  }

  async isVisible(): Promise<boolean> {
    return this.locator.isVisible({ timeout: 2000 }).catch(() => false);
  }
}

export interface PlaywrightSurfaceOptions {
  headless?: boolean;
  slowMoMs?: number;
  viewport?: { width: number; height: number };
}

/**
 * Concrete Playwright implementation of the Surface interface.
 * Uses Chrome Accessibility Tree and multi-tier locator resolution.
 */
export class PlaywrightSurface implements Surface {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private options: PlaywrightSurfaceOptions = {}) {}

  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.options.headless ?? true,
        slowMo: this.options.slowMoMs ?? 0,
      });
      this.context = await this.browser.newContext({
        viewport: this.options.viewport ?? { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
    }
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private getPage(): Page {
    if (!this.page) {
      throw new Error("PlaywrightSurface has not been initialized. Call initialize() first.");
    }
    return this.page;
  }

  async perceive(): Promise<SurfaceSnapshot> {
    const page = this.getPage();
    const url = page.url();
    const title = await page.title();

    // Perceptive Tier 1: Chrome Accessibility Tree / Aria Snapshot
    let axSnapshot: unknown = null;
    try {
      if ("accessibility" in page && typeof (page as any).accessibility?.snapshot === "function") {
        axSnapshot = await (page as any).accessibility.snapshot();
      } else {
        const ariaYaml = await page.locator(":root").ariaSnapshot().catch(() => "");
        axSnapshot = { role: "WebArea", name: title, description: ariaYaml };
      }
    } catch {
      axSnapshot = { role: "WebArea", name: title };
    }
    const normalizedTree: AccessibilityNode = this.normalizeAxNode(axSnapshot);

    // Visible text from body
    const visibleText = await page
      .evaluate(() => document.body?.innerText || "")
      .catch(() => "");

    // Viewport screenshot for multi-modal / visual inspection
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 50 }).catch(() => null);
    const screenshotBase64 = screenshotBuffer ? screenshotBuffer.toString("base64") : undefined;

    return {
      url,
      title,
      accessibilityTree: normalizedTree,
      visibleText,
      screenshotBase64,
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeAxNode(node: unknown): AccessibilityNode {
    if (!node || typeof node !== "object") {
      return { role: "generic" };
    }
    const n = node as Record<string, unknown>;
    const children = Array.isArray(n.children)
      ? n.children.map((c) => this.normalizeAxNode(c))
      : undefined;

    return {
      role: typeof n.role === "string" ? n.role : "generic",
      name: typeof n.name === "string" ? n.name : undefined,
      value: typeof n.value === "string" ? n.value : undefined,
      description: typeof n.description === "string" ? n.description : undefined,
      children,
    };
  }

  async navigate(url: string): Promise<void> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  }

  async locate(targeting: TargetingStrategy): Promise<SurfaceElement | null> {
    const page = this.getPage();

    // Tier 1: Accessibility / Semantic (role + accessible name)
    if (targeting.semantic) {
      const { role, name, exact } = targeting.semantic;
      try {
        let locator: Locator;
        if (role) {
          locator = page.getByRole(role as any, { name, exact });
        } else if (name) {
          locator = page.getByLabel(name, { exact });
        } else {
          locator = page.locator("body");
        }

        if (await locator.first().isVisible({ timeout: 1500 }).catch(() => false)) {
          return new PlaywrightElementHandle("semantic_target", locator.first());
        }
      } catch {
        // Fall through to next tier
      }
    }

    // Tier 2: Anchor text proximity
    if (targeting.anchor) {
      const { anchorText, targetTag } = targeting.anchor;
      try {
        // Find text node then locate adjacent target tag (e.g. input)
        const anchorLocator = page.locator(`text=${anchorText}`).first();
        if (await anchorLocator.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Check sibling or parent container
          const target = anchorLocator.locator(`xpath=following-sibling::${targetTag} | ..//${targetTag}`).first();
          if (await target.isVisible({ timeout: 1000 }).catch(() => false)) {
            return new PlaywrightElementHandle("anchor_target", target);
          }
        }
      } catch {
        // Fall through
      }
    }

    // Tier 3: Structural (XPath or CSS)
    if (targeting.structural) {
      const { xpath, css } = targeting.structural;
      try {
        const selector = xpath ? `xpath=${xpath}` : css;
        if (selector) {
          const locator = page.locator(selector).first();
          if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
            return new PlaywrightElementHandle("structural_target", locator);
          }
        }
      } catch {
        // Fall through
      }
    }

    // Tier 4: Visual coordinate fallback
    if (targeting.visualFallback?.normalizedBounds) {
      try {
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const bounds = targeting.visualFallback.normalizedBounds;
        const clickX = bounds.x * viewport.width + (bounds.width * viewport.width) / 2;
        const clickY = bounds.y * viewport.height + (bounds.height * viewport.height) / 2;

        const locator = page.locator("body");
        return {
          id: "visual_coord_target",
          click: async () => {
            await page.mouse.click(clickX, clickY);
          },
          fill: async (val: string) => {
            await page.mouse.click(clickX, clickY);
            await page.keyboard.type(val);
          },
          press: async (k: string) => {
            await page.keyboard.press(k);
          },
          select: async () => {},
          hover: async () => {
            await page.mouse.move(clickX, clickY);
          },
          getText: async () => "",
          getAttribute: async () => null,
          isVisible: async () => true,
        };
      } catch {
        // Fall through
      }
    }

    return null;
  }

  async act(action: StepAction, targeting?: TargetingStrategy): Promise<ActionResult> {
    const startTime = Date.now();
    try {
      if (action.type === "navigate") {
        await this.navigate(action.url);
        return { success: true, actionType: "navigate", durationMs: Date.now() - startTime };
      }

      if (action.type === "wait") {
        await this.wait(action.timeoutMs);
        return { success: true, actionType: "wait", durationMs: Date.now() - startTime };
      }

      if (targeting) {
        const el = await this.locate(targeting);
        if (!el) {
          return {
            success: false,
            actionType: action.type,
            durationMs: Date.now() - startTime,
            error: "Element could not be resolved through any targeting tier",
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

        return { success: true, actionType: action.type, durationMs: Date.now() - startTime };
      }

      return { success: true, actionType: action.type, durationMs: Date.now() - startTime };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        actionType: action.type,
        durationMs: Date.now() - startTime,
        error: message,
      };
    }
  }

  async evaluateAssertion(
    type: "element_visible" | "text_contains" | "url_matches",
    expectedValue?: string,
    targeting?: TargetingStrategy
  ): Promise<boolean> {
    const page = this.getPage();
    if (type === "url_matches") {
      return expectedValue ? page.url().includes(expectedValue) : false;
    }

    if (type === "text_contains") {
      const text = await page.evaluate(() => document.body?.innerText || "");
      return expectedValue ? text.includes(expectedValue) : false;
    }

    if (type === "element_visible" && targeting) {
      const el = await this.locate(targeting);
      return el !== null && (await el.isVisible());
    }

    return false;
  }

  async dismissOverlays(): Promise<boolean> {
    const page = this.getPage();
    try {
      const dismissButtons = page.locator("button:has-text('Close'), button:has-text('Dismiss'), .modal-close, .toast-close");
      if (await dismissButtons.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await dismissButtons.first().click();
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  async pauseForHuman(_reason: string): Promise<void> {
    // In headed mode, browser remains open for interactive input
  }

  async resumeFromHuman(): Promise<SurfaceSnapshot> {
    return this.perceive();
  }

  async wait(ms: number): Promise<void> {
    const page = this.getPage();
    await page.waitForTimeout(ms);
  }
}
