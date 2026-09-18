import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMClient, AgentDecision, DiscoveryContext } from "./llm-client.interface";
import type { SurfaceSnapshot } from "../surface/surface.interface";

export interface GeminiClientOptions {
  apiKey?: string;
  modelName?: string;
}

export class GeminiClient implements LLMClient {
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      console.warn("⚠️ Warning: GEMINI_API_KEY is not set. GeminiClient will throw on generation calls.");
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = options.modelName || "gemini-1.5-pro";
  }

  async generateDecision(
    snapshot: SurfaceSnapshot,
    context: DiscoveryContext
  ): Promise<AgentDecision> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
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

    const response = await model.generateContent(contents);
    const responseText = response.response.text();

    try {
      const parsed = JSON.parse(responseText);
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
