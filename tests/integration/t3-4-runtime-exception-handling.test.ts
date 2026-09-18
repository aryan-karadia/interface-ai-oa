import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";
import { PlaywrightSurface } from "../../src/surface/playwright-surface";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";

describe("T3.4: Runtime Exception Handling & Evidence Capture", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const artifactPath = resolve(
    rootDir,
    "artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json"
  );
  const evidenceDir = resolve(rootDir, "evidence/replay-error");

  const rawArtifact: ArtifactSpec = JSON.parse(readFileSync(artifactPath, "utf-8"));

  test("validates input types and validation regex, rejecting invalid inputs before execution", async () => {
    const surface = new MockSurface();
    const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
    const executor = new ReplayExecutor(surface, guardrail);

    const artifactWithRegex: ArtifactSpec = {
      ...rawArtifact,
      inputs: {
        memberId: {
          type: "string",
          description: "Must be 5 numeric digits",
          required: true,
          validationRegex: "^\\d{5}$",
        },
      },
    };

    // Invalid input: alpha characters instead of 5 digits
    const result = await executor.execute(artifactWithRegex, {
      inputs: { memberId: "ABC_INVALID" },
    });

    expect(result.status).toBe("HARD_FAILURE");
    if (result.status === "HARD_FAILURE") {
      expect(result.category).toBe("SCHEMA_MISMATCH");
      expect(result.message).toContain("validationRegex");
    }
  });

  test("handles permission denial via GuardrailService, returning HARD_FAILURE", async () => {
    const surface = new MockSurface();
    // Guardrail strictly limits to internal.domain.local
    const guardrail = new GuardrailService({
      allowedDomains: ["internal.domain.local"],
    });
    const executor = new ReplayExecutor(surface, guardrail);

    const result = await executor.execute(rawArtifact, {
      inputs: { memberId: "10042" },
    });

    expect(result.status).toBe("HARD_FAILURE");
    if (result.status === "HARD_FAILURE") {
      expect(result.category).toBe("GUARDRAIL_VIOLATION");
    }
  });

  test("detects modal occlusion and returns RECOVERABLE_RUNTIME_CONDITION when stopOnRecoverable set", async () => {
    const surface = new MockSurface();
    surface.overlayActive = true; // Modal banner occludes everything

    const guardrail = new GuardrailService({ allowedDomains: ["localhost", "127.0.0.1"] });
    const executor = new ReplayExecutor(surface, guardrail);

    const result = await executor.execute(rawArtifact, {
      inputs: { memberId: "10042" },
      stopOnRecoverable: true,
    });

    expect(result.status).toBe("RECOVERABLE_RUNTIME_CONDITION");
    if (result.status === "RECOVERABLE_RUNTIME_CONDITION") {
      expect(result.reason).toBe("ELEMENT_OCCLUDED");
      expect(result.suggestedAction).toBe("DISMISS_OVERLAY_AND_RETRY");
    }
  });

  describe("live exceptional-state replay & evidence capture (/evidence/replay-error/)", () => {
    const testPort = 3091;
    let server: ReturnType<typeof startLegacyPortalServer>;
    let surface: PlaywrightSurface;

    beforeAll(async () => {
      server = startLegacyPortalServer(testPort);
      surface = new PlaywrightSurface({ headless: true });
      await surface.initialize();
    });

    afterAll(async () => {
      await surface.close();
      server.stop();
    });

    test("replays non-existent member (99999), detects business outcome, and captures evidence", async () => {
      const guardrail = new GuardrailService({
        allowedDomains: ["localhost", "127.0.0.1"],
      });

      const executor = new ReplayExecutor(surface, guardrail);

      // Point entryUrl to test server port
      const testArtifact: ArtifactSpec = {
        ...rawArtifact,
        target: {
          ...rawArtifact.target,
          entryUrl: `http://localhost:${testPort}/portal/search`,
        },
        steps: rawArtifact.steps.map((step) => {
          if (step.action.type === "navigate") {
            return {
              ...step,
              action: {
                ...step.action,
                url: `http://localhost:${testPort}/portal/search`,
              },
            };
          }
          return step;
        }),
      };

      // Query non-existent member 99999
      const result = await executor.execute(testArtifact, {
        inputs: { memberId: "99999" },
        evidenceDir,
      });

      // Assert outcome classification
      expect(result.status).toBe("BUSINESS_OUTCOME");
      if (result.status === "BUSINESS_OUTCOME") {
        expect(result.outcomeCode).toBe("MEMBER_NOT_FOUND");
        expect(result.evidence.detectedText).toContain("No active member records found");
      }

      // Assert that Section 6 required evidence in /evidence/replay-error/ was captured
      const manifestPath = resolve(evidenceDir, "run-manifest.json");
      const replayResultPath = resolve(evidenceDir, "replay-result.json");
      const domSnapshotPath = resolve(evidenceDir, "dom-snapshot.json");
      const screenshotPath = resolve(evidenceDir, "screenshot-failure.jpeg");

      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(replayResultPath)).toBe(true);
      expect(existsSync(domSnapshotPath)).toBe(true);
      expect(existsSync(screenshotPath)).toBe(true);

      // Verify screenshot contains actual JPEG binary bytes
      const screenshotStat = statSync(screenshotPath);
      expect(screenshotStat.size).toBeGreaterThan(500);

      // Verify manifest content
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.status).toBe("BUSINESS_OUTCOME");
      expect(manifest.inputs.memberId).toBe("99999");
    });
  });
});
