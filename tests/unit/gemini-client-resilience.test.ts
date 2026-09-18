import { describe, expect, test } from "bun:test";
import { GeminiClient } from "../../src/discovery/gemini-client";

describe("GeminiClient Transient Resilience & Model Failover", () => {
  test("retries on transient 503 error and succeeds on subsequent attempt", async () => {
    let callCount = 0;
    const client = new GeminiClient({
      apiKey: "dummy-key",
      modelName: "gemini-3.6-flash",
      maxRetries: 3,
      retryDelayMs: 10,
    });

    // Mock internal generateWithRetry
    const mockGenerate = async () => {
      callCount++;
      if (callCount < 3) {
        const err = new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary.");
        (err as any).status = 503;
        throw err;
      }
      return {
        response: {
          text: () => JSON.stringify({ thought: "Recovered from 503", goalMet: true }),
        },
      };
    };

    const result = await (client as any).executeWithFailover(mockGenerate);
    expect(callCount).toBe(3);
    expect(result.response.text()).toContain("Recovered from 503");
  });

  test("fails over to backup model when primary model persistently returns 503", async () => {
    const attemptedModels: string[] = [];
    const client = new GeminiClient({
      apiKey: "dummy-key",
      modelName: "gemini-3.6-flash",
      maxRetries: 2,
      retryDelayMs: 10,
      fallbackModels: ["gemini-3.6-flash", "gemini-flash-latest"],
    });

    const mockGenerateForModel = async (modelName: string) => {
      attemptedModels.push(modelName);
      if (modelName === "gemini-3.6-flash") {
        const err = new Error("503 Service Unavailable");
        (err as any).status = 503;
        throw err;
      }
      return {
        response: {
          text: () => JSON.stringify({ thought: "Succeeded via fallback model", goalMet: true }),
        },
      };
    };

    const result = await (client as any).generateDecisionInternal(
      { url: "http://localhost", title: "Test", accessibilityTree: { role: "WebArea" }, visibleText: "", timestamp: "" },
      { goal: "Test goal", appId: "test", history: [] },
      mockGenerateForModel
    );

    expect(attemptedModels).toContain("gemini-3.6-flash");
    expect(attemptedModels).toContain("gemini-flash-latest");
    expect(result.thought).toBe("Succeeded via fallback model");
    expect(result.goalMet).toBe(true);
  });
});
