import { describe, expect, test } from "bun:test";
import { MockSurface } from "../../src/surface/mock-surface";
import { MockLLMClient } from "../../src/discovery/mock-llm-client";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { DiscoveryAgent } from "../../src/discovery/agent";

describe("Discovery Agent Loop", () => {
  test("observes, decides, acts, and compiles canonical artifact upon goal completion", async () => {
    const surface = new MockSurface();
    surface.setElement("input_search", { role: "textbox", name: "Search Member", visible: true });

    const mockLLM = new MockLLMClient([
      {
        thought: "I see the member search textbox. Let me fill the member ID.",
        action: { type: "fill", valueTemplate: "10042" },
        targeting: { semantic: { role: "textbox", name: "Search Member" } },
        goalMet: false,
      },
      {
        thought: "Input filled. Goal is now achieved.",
        goalMet: true,
      },
    ]);

    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const agent = new DiscoveryAgent(surface, mockLLM, guardrail);

    const result = await agent.discover({
      goal: "Search for member 10042",
      appId: "legacy-portal",
      entryUrl: "http://localhost:3000/portal/search",
      allowedDomains: ["localhost"],
      maxSteps: 5,
    });

    expect(result.success).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(result.artifact?.id).toContain("artifact_legacy-portal");
    expect(result.transcript.length).toBeGreaterThanOrEqual(2);
    expect(result.artifact?.steps.length).toBeGreaterThanOrEqual(1);
  });
});
