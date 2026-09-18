import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMClient, AgentDecision, DiscoveryContext } from "./llm-client.interface";
import type { SurfaceSnapshot } from "../surface/surface.interface";

export interface GeminiClientOptions {
  apiKey?: string;
  modelName?: string;
  fallbackModels?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
}

export class GeminiClient implements LLMClient {
  private client: GoogleGenerativeAI;
  public modelName: string;
  public fallbackModels: string[];
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey =
      options.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "";
    if (!apiKey) {
      console.warn("⚠️ Warning: GEMINI_API_KEY or GOOGLE_API_KEY is not set. GeminiClient will throw on generation calls.");
    }
    this.client = new GoogleGenerativeAI(apiKey);

    const primaryModel =
      options.modelName ||
      process.env.GEMINI_MODEL ||
      "gemini-flash-latest";

    this.modelName = primaryModel;

    // Automatic failover chain: if primary is experiencing high demand (503), fall over
    const configuredFallbacks = options.fallbackModels || [
      primaryModel,
      "gemini-flash-latest",
      "gemini-3.6-flash",
    ];
    // Deduplicate preserving order
    this.fallbackModels = Array.from(new Set(configuredFallbacks));

    this.maxRetries = options.maxRetries ?? Number(process.env.GEMINI_MAX_RETRIES || 3);
    this.retryDelayMs = options.retryDelayMs ?? Number(process.env.GEMINI_RETRY_DELAY_MS || 1500);
  }

  async generateDecision(
    snapshot: SurfaceSnapshot,
    context: DiscoveryContext
  ): Promise<AgentDecision> {
    return this.generateDecisionInternal(snapshot, context, async (modelName) => {
      const model = this.client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

      const prompt = this.buildPrompt(snapshot, context);
      const contents: any[] = [prompt];

      if (snapshot.screenshotBase64) {
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: snapshot.screenshotBase64,
          },
        });
      }

      return model.generateContent(contents);
    });
  }

  /**
   * Internal generator with automatic multi-model failover and retry.
   */
  async generateDecisionInternal(
    _snapshot: SurfaceSnapshot,
    _context: DiscoveryContext,
    generator: (modelName: string) => Promise<any>
  ): Promise<AgentDecision> {
    let lastError: any = null;

    for (const currentModel of this.fallbackModels) {
      try {
        const response = await this.executeWithRetry(
          () => generator(currentModel),
          currentModel
        );
        const responseText = response.response.text();

        try {
          const parsed = JSON.parse(responseText);
          // If we succeeded on a fallback model, update current active model
          if (this.modelName !== currentModel) {
            console.log(`ℹ️  Active Gemini model switched to ${currentModel}`);
            this.modelName = currentModel;
          }

          return {
            thought: parsed.thought || "Observing UI state",
            action: parsed.action,
            targeting: parsed.targeting,
            goalMet: Boolean(parsed.goalMet),
            notes: parsed.notes,
          };
        } catch (err) {
          throw new Error(`Failed to parse Gemini response as JSON: ${responseText}`);
        }
      } catch (err: any) {
        lastError = err;
        console.warn(
          `⚠️ Model ${currentModel} failed (${err.status || err.message?.substring(0, 80)}). Trying fallback model...`
        );
      }
    }

    throw lastError || new Error("All Gemini models in fallback chain failed.");
  }

  /**
   * Retries an operation with exponential backoff on transient errors (503, 429, 500, 502, 504).
   */
  async executeWithRetry<T>(generate: () => Promise<T>, modelName = this.modelName): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await generate();
      } catch (error: any) {
        const status = error?.status;
        const msg = String(error?.message || "");

        const is503HighDemand =
          status === 503 ||
          msg.includes("503") ||
          msg.includes("Service Unavailable") ||
          msg.includes("high demand");

        const isRateLimit =
          status === 429 ||
          msg.includes("429") ||
          msg.includes("Resource Exhausted") ||
          msg.includes("RESOURCE_EXHAUSTED");

        const isTransientServerGlitch =
          status === 500 || status === 502 || status === 504;

        const isRetryable = is503HighDemand || isRateLimit || isTransientServerGlitch;

        if (!isRetryable || attempt >= this.maxRetries) {
          throw error;
        }

        const delayMs = this.retryDelayMs * 2 ** attempt + Math.floor(Math.random() * 500);
        console.warn(
          `⚠️ [Gemini ${modelName}] Transient ${status || "error"} (${is503HighDemand ? "High Demand" : "Rate Limit"}); retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async executeWithFailover<T>(generate: () => Promise<T>): Promise<T> {
    return this.executeWithRetry(generate);
  }

  private buildPrompt(snapshot: SurfaceSnapshot, context: DiscoveryContext): string {
    return `You are an expert Computer-Use Automation Agent.
Your task is to achieve the user's goal by navigating and interacting with a legacy enterprise web application.

GOAL: ${context.goal}
TARGET APP: ${context.appId}

CURRENT URL: ${snapshot.url}
PAGE TITLE: ${snapshot.title}

ACCESSIBILITY TREE SNAPSHOT:
${JSON.stringify(snapshot.accessibilityTree, null, 2)}

VISIBLE TEXT SUMMARY:
${snapshot.visibleText.substring(0, 1500)}

INTERACTION HISTORY:
${context.history.map((h) => `Step ${h.stepNumber}: Thought: "${h.thought}" -> Action: ${h.actionType} -> Result: ${h.resultSummary}`).join("\n") || "None (Initial Step)"}

INSTRUCTIONS:
1. Examine the accessibility tree and visible elements to find the next logical action.
2. Provide your reasoning in the "thought" field.
3. If the goal has been achieved, set "goalMet": true and omit "action".
4. When targeting elements, prioritize:
   - semantic: { role: "...", name: "..." }
   - anchor: { anchorText: "Label Text", targetTag: "input" }
   - structural: { css: "...", xpath: "..." }
5. Allowed actions:
   - { "type": "navigate", "url": "..." }
   - { "type": "click" }
   - { "type": "fill", "valueTemplate": "..." }
   - { "type": "wait", "timeoutMs": 1000 }

Respond ONLY with a JSON object matching this schema:
{
  "thought": "description of observation and rationale",
  "goalMet": false,
  "action": { "type": "click" | "fill" | "navigate" | "wait", ... },
  "targeting": {
    "semantic": { "role": "button", "name": "Search" },
    "anchor": { "anchorText": "Member ID:" }
  },
  "notes": "optional notes"
}`;
  }
}
