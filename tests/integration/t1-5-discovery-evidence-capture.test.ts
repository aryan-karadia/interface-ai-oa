import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";
import { validateArtifact } from "../../src/artifact/artifact.validator";
import { DiscoveryAgent } from "../../src/discovery/agent";
import { GeminiClient } from "../../src/discovery/gemini-client";
import { MockLLMClient } from "../../src/discovery/mock-llm-client";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { PlaywrightSurface } from "../../src/surface/playwright-surface";

describe("T1.5: Live Discovery Run & Evidence Capture", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const evidenceDir = resolve(rootDir, "evidence/discovery");

  test("runs real discovery against live target and captures raw evidence", async () => {
    // Clean evidence directory before test
    if (existsSync(evidenceDir)) {
      try {
        const files = readdirSync(evidenceDir);
        for (const file of files) {
          try {
            rmSync(resolve(evidenceDir, file), { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    const testPort = 3088;
    const server = startLegacyPortalServer(testPort);
    const surface = new PlaywrightSurface({ headless: true });
    await surface.initialize();

    const guardrail = new GuardrailService({
      allowedDomains: ["localhost", "127.0.0.1"],
    });

    // In automated test suites, use deterministic mock planner by default to prevent API quota exhaustion.
    // Set TEST_WITH_LIVE_LLM=true to run the integration test against live Gemini.
    const useLive = process.env.TEST_WITH_LIVE_LLM === "true";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const llmClient =
      useLive && apiKey
        ? new GeminiClient({ apiKey })
        : new MockLLMClient([
            {
              thought:
                "I see the Member ID input field adjacent to 'Member ID:'. Let me fill it with member ID 10042.",
              action: { type: "fill", valueTemplate: "10042" },
              targeting: {
                anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" },
                structural: { css: "#ctl00_MainContent_tabSearch_txtMemberId_8912" },
              },
              goalMet: false,
            },
            {
              thought: "The member ID is entered. Now I will click the Search button.",
              action: { type: "click" },
              targeting: {
                semantic: { name: "Search" },
                structural: { css: "#ctl00_MainContent_btnSearch_329a" },
              },
              goalMet: false,
            },
            {
              thought:
                "The member record table (#ctl00_gridMemberDetails) is displayed showing Alice Henderson and balance $240.50. The goal is fulfilled.",
              goalMet: true,
            },
          ]);

    const agent = new DiscoveryAgent(surface, llmClient, guardrail);

    try {
      const result = await agent.discover({
        goal: "Look up member 10042 and view account details",
        appId: "legacy-core-portal",
        entryUrl: `http://localhost:${testPort}/portal/search`,
        allowedDomains: ["localhost"],
        maxSteps: 5,
        evidenceDir,
      });

      expect(result.success).toBe(true);
      expect(result.artifact).toBeDefined();

      // Verify evidence folder contents
      expect(existsSync(evidenceDir)).toBe(true);
      const files = readdirSync(evidenceDir);

      expect(files).toContain("transcript.json");
      expect(files).toContain("synthesized-artifact.json");
      expect(files.some((f) => f.startsWith("screenshot-step-"))).toBe(true);
      expect(files.some((f) => f.startsWith("dom-snapshot-step-"))).toBe(true);

      // Validate the synthesized artifact
      const artifactRaw = JSON.parse(
        readFileSync(resolve(evidenceDir, "synthesized-artifact.json"), "utf-8"),
      );
      const validation = validateArtifact(artifactRaw);
      expect(validation.valid).toBe(true);
    } finally {
      await surface.close();
      server.stop();
    }
  }, 30000);
});
