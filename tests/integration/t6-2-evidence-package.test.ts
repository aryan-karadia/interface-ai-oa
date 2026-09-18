import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateArtifact } from "../../src/artifact/artifact.validator";

describe("T6.2: /evidence/ Package Validation (Section 6 Deliverable #3)", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const evidenceDir = resolve(rootDir, "evidence");

  test("saved example artifact exists in artifacts repository and satisfies schema contract", () => {
    const artifactPath = resolve(
      rootDir,
      "artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json",
    );
    expect(existsSync(artifactPath)).toBe(true);

    const artifactContent = JSON.parse(readFileSync(artifactPath, "utf-8"));
    const validation = validateArtifact(artifactContent);
    expect(validation.valid).toBe(true);
    expect(validation.artifact?.id).toBe("legacy.portal.lookup_member");
    expect(validation.artifact?.schemaVersion).toBe("1.0.0");
    expect(validation.artifact?.steps.length).toBeGreaterThan(0);
    expect(validation.artifact?.checkpoint?.successCondition).toBeDefined();
  });

  test("discovery run evidence (/evidence/discovery/) contains required transcript, artifact, logs, and visual snapshots", () => {
    const dir = join(evidenceDir, "discovery");
    expect(existsSync(dir)).toBe(true);

    const files = readdirSync(dir);
    expect(files).toContain("transcript.json");
    expect(files).toContain("synthesized-artifact.json");
    expect(files).toContain("structured.log.jsonl");

    // Check transcript structure
    const transcript = JSON.parse(readFileSync(join(dir, "transcript.json"), "utf-8"));
    expect(Array.isArray(transcript)).toBe(true);
    expect(transcript.length).toBeGreaterThan(0);
    expect(transcript[0].step).toBe(1);
    expect(transcript[0].thought).toBeDefined();

    // Check synthesized artifact validation
    const synthesized = JSON.parse(readFileSync(join(dir, "synthesized-artifact.json"), "utf-8"));
    const validation = validateArtifact(synthesized);
    expect(validation.valid).toBe(true);

    // Check structured logs
    const logContent = readFileSync(join(dir, "structured.log.jsonl"), "utf-8").trim();
    const logLines = logContent.split("\n").map((line) => JSON.parse(line));
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.some((l) => l.subsystem === "discovery")).toBe(true);

    // Check perceptual evidence
    expect(files.some((f) => f.startsWith("screenshot-step-"))).toBe(true);
    expect(files.some((f) => f.startsWith("dom-snapshot-step-"))).toBe(true);
  });

  test("successful replay run evidence (/evidence/replay/ & /evidence/replay-success/) contains manifest, logs, and artifacts", () => {
    const replayDirs = [join(evidenceDir, "replay-success"), join(evidenceDir, "replay")];

    for (const dir of replayDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir);
      expect(files).toContain("run-manifest.json");
      expect(files).toContain("replay-result.json");
      expect(files).toContain("dom-snapshot.json");
      expect(files).toContain("structured.log.jsonl");
      expect(files).toContain("replayed-artifact.json");

      const result = JSON.parse(readFileSync(join(dir, "replay-result.json"), "utf-8"));
      expect(result.status).toBe("SUCCESS");
      expect(result.outputs).toBeDefined();
      expect(result.telemetry).toBeDefined();

      const manifest = JSON.parse(readFileSync(join(dir, "run-manifest.json"), "utf-8"));
      expect(manifest.status).toBe("SUCCESS");
      expect(manifest.runId).toBeDefined();

      // Check log lines
      const logContent = readFileSync(join(dir, "structured.log.jsonl"), "utf-8").trim();
      const logLines = logContent.split("\n").map((line) => JSON.parse(line));
      expect(logLines.some((l) => l.subsystem === "replay")).toBe(true);

      // Check screenshot
      const hasScreenshot =
        files.includes("screenshot-success.jpeg") || files.includes("screenshot.jpeg");
      expect(hasScreenshot).toBe(true);
    }
  });

  test("exceptional-state replay run evidence (/evidence/replay-error/) contains manifest, logs, and business outcome", () => {
    const dir = join(evidenceDir, "replay-error");
    expect(existsSync(dir)).toBe(true);

    const files = readdirSync(dir);
    expect(files).toContain("run-manifest.json");
    expect(files).toContain("replay-result.json");
    expect(files).toContain("dom-snapshot.json");
    expect(files).toContain("structured.log.jsonl");
    expect(files).toContain("screenshot-failure.jpeg");

    const result = JSON.parse(readFileSync(join(dir, "replay-result.json"), "utf-8"));
    expect(result.status).toBe("BUSINESS_OUTCOME");
    expect(result.outcomeCode).toBe("MEMBER_NOT_FOUND");
    expect(result.evidence).toBeDefined();

    const manifest = JSON.parse(readFileSync(join(dir, "run-manifest.json"), "utf-8"));
    expect(manifest.status).toBe("BUSINESS_OUTCOME");
    expect(manifest.inputs.memberId).toBe("99999");

    const logContent = readFileSync(join(dir, "structured.log.jsonl"), "utf-8").trim();
    const logLines = logContent.split("\n").map((line) => JSON.parse(line));
    expect(logLines.some((l) => l.action === "EXECUTE_FINISH")).toBe(true);
  });

  test("handoff escalation evidence (/evidence/handoff/) contains request, resolution, timeline, and logs", () => {
    const dir = join(evidenceDir, "handoff");
    expect(existsSync(dir)).toBe(true);

    const files = readdirSync(dir);
    expect(files).toContain("intervention-request.json");
    expect(files).toContain("intervention-resolution.json");
    expect(files).toContain("handoff-timeline.json");
    expect(files).toContain("dom-snapshot-post-handoff.json");
    expect(files).toContain("screenshot-post-handoff.jpeg");
    expect(files).toContain("structured.log.jsonl");

    const req = JSON.parse(readFileSync(join(dir, "intervention-request.json"), "utf-8"));
    expect(req.reason).toBe("TARGETING_EXHAUSTED");

    const res = JSON.parse(readFileSync(join(dir, "intervention-resolution.json"), "utf-8"));
    expect(res.resolution.resolvedBy).toBe("operator");
    expect(res.operatorActions.length).toBeGreaterThan(0);

    const timeline = JSON.parse(readFileSync(join(dir, "handoff-timeline.json"), "utf-8"));
    expect(timeline.length).toBeGreaterThanOrEqual(4);

    const logContent = readFileSync(join(dir, "structured.log.jsonl"), "utf-8").trim();
    const logLines = logContent.split("\n").map((line) => JSON.parse(line));
    expect(logLines.some((l) => l.subsystem === "escalation")).toBe(true);
  });

  test("audit: all JSON and JSONL evidence files across /evidence/ are 100% free of unredacted PII", () => {
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    const creditCardPattern = /\b(?:\d{4}[- ]?){3}\d{4}\b/;
    const secretKeyPattern =
      /(sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9\-._~+/]+=*|AIza[0-9A-Za-z\-_]{35})/;

    function scanDir(directory: string): void {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) {
          const content = readFileSync(fullPath, "utf-8");
          // Ensure no raw SSN matches
          const ssnMatch = content.match(ssnPattern);
          expect(ssnMatch).toBeNull();

          // Ensure no raw credit cards
          const ccMatch = content.match(creditCardPattern);
          expect(ccMatch).toBeNull();

          // Ensure no raw secrets
          const secretMatch = content.match(secretKeyPattern);
          expect(secretMatch).toBeNull();
        }
      }
    }

    scanDir(evidenceDir);
  });
});
