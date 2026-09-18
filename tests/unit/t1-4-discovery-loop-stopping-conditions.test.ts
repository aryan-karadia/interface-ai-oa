import { describe, expect, test } from "bun:test";
import { DiscoveryAgent } from "../../src/discovery/agent";
import { MockLLMClient } from "../../src/discovery/mock-llm-client";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T1.4: LLM observe->decide->act loop stopping conditions", () => {
  const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });

  test("stops when maxSteps limit is reached", async () => {
    const surface = new MockSurface();
    surface.setElement("btn", { role: "button", name: "Next", visible: true });

    // Client provides 10 distinct actions, but maxSteps is set to 3
    const decisions = Array.from({ length: 10 }, (_, i) => ({
      thought: `Step ${i}`,
      action: { type: "wait" as const, timeoutMs: i + 1 },
      goalMet: false,
    }));
    const mockLLM = new MockLLMClient(decisions);
    const agent = new DiscoveryAgent(surface, mockLLM, guardrail);

    const result = await agent.discover({
      goal: "Reach final step",
      appId: "test-app",
      entryUrl: "http://localhost:3000",
      allowedDomains: ["localhost"],
      maxSteps: 3,
    });

    expect(result.success).toBe(false);
    expect(result.stepsTaken).toBe(3);
    expect(result.error).toContain("max steps limit");
  });

  test("stops when timeoutMs budget is exceeded", async () => {
    const surface = new MockSurface();
    // Simulate slow action execution
    const origAct = surface.act.bind(surface);
    surface.act = async (action, targeting) => {
      await new Promise((r) => setTimeout(r, 60));
      return origAct(action, targeting);
    };

    const decisions = Array(10).fill({
      thought: "Slow step",
      action: { type: "wait", timeoutMs: 10 },
      goalMet: false,
    });
    const mockLLM = new MockLLMClient(decisions);
    const agent = new DiscoveryAgent(surface, mockLLM, guardrail);

    const result = await agent.discover({
      goal: "Complete slow workflow",
      appId: "test-app",
      entryUrl: "http://localhost:3000",
      allowedDomains: ["localhost"],
      maxSteps: 10,
      timeoutMs: 80, // Very tight timeout
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  test("stops when a repetitive action dead-end is detected", async () => {
    const surface = new MockSurface();
    surface.setElement("stuck_btn", { role: "button", name: "Stuck", visible: true });

    // Repetitive identical action loop: clicking the same element 4 times without state change
    const decisions = Array(5).fill({
      thought: "Clicking stuck button repeatedly",
      action: { type: "click" },
      targeting: { semantic: { role: "button", name: "Stuck" } },
      goalMet: false,
    });
    const mockLLM = new MockLLMClient(decisions);
    const agent = new DiscoveryAgent(surface, mockLLM, guardrail);

    const result = await agent.discover({
      goal: "Get unstuck",
      appId: "test-app",
      entryUrl: "http://localhost:3000",
      allowedDomains: ["localhost"],
      maxSteps: 10,
      maxConsecutiveIdenticalActions: 3,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("dead-end");
  });
});
