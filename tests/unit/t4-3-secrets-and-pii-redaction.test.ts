import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileDiscoveryEvidence } from "../../src/artifact/compiler";
import { DiscoveryAgent } from "../../src/discovery/agent";
import type { AgentDecision, LLMClient } from "../../src/discovery/llm-client.interface";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { Redactor } from "../../src/guardrail/redactor";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T4.3: Secrets & PII Redaction at Point of Capture", () => {
  const scratchEvidenceDir = resolve(import.meta.dir, "../../scratch/test-pii-evidence");

  describe("Redactor Pattern Coverage", () => {
    test("redacts Social Security Numbers (SSN) in standard formats", () => {
      const text = "Member Tax ID is 987-65-4321 and spouse is 123-45-6789.";
      const scrubbed = Redactor.redact(text);
      expect(scrubbed).not.toContain("987-65-4321");
      expect(scrubbed).not.toContain("123-45-6789");
      expect(scrubbed).toBe("Member Tax ID is [REDACTED_SSN] and spouse is [REDACTED_SSN].");
    });

    test("redacts 16-digit credit card numbers with hyphens, spaces, or raw digits", () => {
      const text = "Cards: 4111-2222-3333-4444 and 5500 0000 0000 0004 and 4000123456789010";
      const scrubbed = Redactor.redact(text);
      expect(scrubbed).not.toContain("4111-2222-3333-4444");
      expect(scrubbed).not.toContain("5500 0000 0000 0004");
      expect(scrubbed).not.toContain("4000123456789010");
      expect(scrubbed).toContain("[REDACTED_CREDIT_CARD]");
    });

    test("redacts API keys and Bearer authentication tokens", () => {
      const text =
        "Using key sk-1234567890abcdef1234567890 and token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const scrubbed = Redactor.redact(text);
      expect(scrubbed).not.toContain("sk-1234567890abcdef1234567890");
      expect(scrubbed).not.toContain("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(scrubbed).toContain("[REDACTED_SECRET]");
    });

    test("redacts email addresses and phone numbers", () => {
      const text =
        "Contact alice.henderson@enterprise-corp.com or call 555-867-5309 or (800) 555-0199.";
      const scrubbed = Redactor.redact(text);
      expect(scrubbed).not.toContain("alice.henderson@enterprise-corp.com");
      expect(scrubbed).not.toContain("555-867-5309");
      expect(scrubbed).toContain("[REDACTED_EMAIL]");
      expect(scrubbed).toContain("[REDACTED_PHONE]");
    });

    test("redactDeep recursively sanitizes deeply nested objects, arrays, and keys", () => {
      const complexObject = {
        session: {
          token: "secret-token-value-9999",
          user: {
            ssn: "987-65-4321",
            contact: {
              email: "victim@example.com",
              notes: ["Card on file: 4111-2222-3333-4444", "Verified phone: 555-123-4567"],
            },
          },
        },
        credentials: {
          password: "MySuperSecretPassword#123",
          apiKey: "sk-ant-api03-abcdef1234567890abcdef1234",
        },
      };

      const cleaned = Redactor.redactDeep(complexObject);
      const json = JSON.stringify(cleaned);

      expect(json).not.toContain("987-65-4321");
      expect(json).not.toContain("4111-2222-3333-4444");
      expect(json).not.toContain("victim@example.com");
      expect(json).not.toContain("555-123-4567");
      expect(json).not.toContain("MySuperSecretPassword#123");
      expect(json).not.toContain("sk-ant-api03-abcdef1234567890abcdef1234");
      expect(json).toContain("[REDACTED_SSN]");
      expect(json).toContain("[REDACTED_SECRET]");
    });
  });

  describe("Point of Capture: Discovery Evidence Redaction", () => {
    const discoveryEvidenceDir = join(scratchEvidenceDir, "discovery");

    test("discovery agent redacts PII before writing DOM snapshots, transcripts, and synthesized artifacts", async () => {
      if (existsSync(discoveryEvidenceDir)) {
        rmSync(discoveryEvidenceDir, { recursive: true });
      }
      mkdirSync(discoveryEvidenceDir, { recursive: true });

      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      // Populate surface with fixture-like PII
      surface.setElement("txt_tax_id", {
        id: "ctl00_out_ssn",
        text: "Tax Identifier (PII): 987-65-4321",
        visible: true,
      });
      surface.setElement("txt_cc", {
        id: "ctl00_out_cc",
        text: "Auto-pay Card: 4111-2222-3333-4444",
        visible: true,
      });

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        redactionEnabled: true,
      });

      // Mock LLM completing discovery
      const mockLLM: LLMClient = {
        generateDecision: async (): Promise<AgentDecision> => ({
          thought: "Found member tax ID 987-65-4321 and card 4111-2222-3333-4444",
          action: undefined,
          goalMet: true,
        }),
      };

      const agent = new DiscoveryAgent(surface, mockLLM, guardrail);
      const result = await agent.discover({
        appId: "legacy-core-portal",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
        goal: "Lookup member account",
        evidenceDir: discoveryEvidenceDir,
        maxSteps: 1,
      });

      expect(result.success).toBe(true);

      // Now verify every single file written to disk has NO raw PII
      const writtenFiles = readdirSync(discoveryEvidenceDir);
      expect(writtenFiles.length).toBeGreaterThan(0);

      for (const fileName of writtenFiles) {
        const filePath = join(discoveryEvidenceDir, fileName);
        if (fileName.endsWith(".json")) {
          const fileContent = readFileSync(filePath, "utf-8");
          expect(fileContent).not.toContain("987-65-4321");
          expect(fileContent).not.toContain("4111-2222-3333-4444");
        }
      }

      // Check specifically that dom snapshot and transcript have redacted markers
      const domContent = readFileSync(
        join(discoveryEvidenceDir, "dom-snapshot-step-1.json"),
        "utf-8",
      );
      expect(domContent).toContain("[REDACTED_SSN]");
      expect(domContent).toContain("[REDACTED_CREDIT_CARD]");

      const transcriptContent = readFileSync(
        join(discoveryEvidenceDir, "transcript.json"),
        "utf-8",
      );
      expect(transcriptContent).toContain("[REDACTED_SSN]");
    });
  });

  describe("Point of Capture: Replay Failure Evidence Redaction", () => {
    const replayEvidenceDir = join(scratchEvidenceDir, "replay");

    test("replay executor redacts PII before saving failure diagnostic snapshots and manifests", async () => {
      if (existsSync(replayEvidenceDir)) {
        rmSync(replayEvidenceDir, { recursive: true });
      }
      mkdirSync(replayEvidenceDir, { recursive: true });

      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      surface.setElement("sensitive_dom_node", {
        id: "tax_id_container",
        text: "Member SSN: 987-65-4321 and Card: 4111-2222-3333-4444",
        visible: true,
      });

      const guardrail = new GuardrailService({
        allowedDomains: ["localhost"],
        redactionEnabled: true,
      });

      const executor = new ReplayExecutor(surface, guardrail);
      // Artifact that will trigger failure on non-existent element
      const failingArtifact = {
        schemaVersion: "1.0.0",
        id: "failing.artifact",
        name: "Failing Test Run",
        description: "Test diagnostic capture",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "test-app",
          entryUrl: "http://localhost:3000/portal/search",
          allowedDomains: ["localhost"],
        },
        steps: [
          {
            id: "step_impossible",
            description: "Click missing button",
            action: { type: "click" as const },
            targeting: { structural: { css: "#non_existent_elem" } },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: {
              type: "element_visible" as const,
              targeting: { structural: { css: "#done" } },
            },
          },
        },
      };

      const result = await executor.execute(failingArtifact as any, {
        evidenceDir: replayEvidenceDir,
      });
      expect(result.status).toBe("HARD_FAILURE");

      // Verify all saved replay evidence files
      const writtenFiles = readdirSync(replayEvidenceDir);
      expect(writtenFiles.length).toBeGreaterThan(0);

      for (const fileName of writtenFiles) {
        const filePath = join(replayEvidenceDir, fileName);
        if (fileName.endsWith(".json")) {
          const fileContent = readFileSync(filePath, "utf-8");
          expect(fileContent).not.toContain("987-65-4321");
          expect(fileContent).not.toContain("4111-2222-3333-4444");
        }
      }

      const domSnapshot = readFileSync(join(replayEvidenceDir, "dom-snapshot.json"), "utf-8");
      expect(domSnapshot).toContain("[REDACTED_SSN]");
    });
  });

  describe("Point of Capture: Artifact Compiler Sanitization", () => {
    test("compiler sanitizes declared sensitive inputs and redacts PII from output descriptions", () => {
      const compiled = compileDiscoveryEvidence({
        appId: "legacy-core-portal",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
        goal: "Lookup member account",
        recordedSteps: [
          {
            step: 1,
            thought: "Enter password and search",
            action: { type: "fill", valueTemplate: "SecretPass123!" },
            targeting: { semantic: { name: "Password" } },
            success: true,
          },
        ],
        declaredInputs: {
          userPassword: {
            type: "string",
            description: "Authentication password containing SecretPass123!",
            sensitive: true,
            value: "SecretPass123!",
          },
        },
        observedOutputs: {
          ssnOutput: {
            type: "string",
            description: "Extract SSN 987-65-4321 for verification",
            selector: { structural: { css: "#ctl00_out_ssn" } },
          },
        },
      });

      expect(compiled.inputs?.userPassword.sensitive).toBe(true);
      expect(compiled.inputs?.userPassword.description).not.toContain("SecretPass123!");
      expect(compiled.outputs?.ssnOutput.description).not.toContain("987-65-4321");
      expect(compiled.outputs?.ssnOutput.description).toContain("[REDACTED_SSN]");
    });
  });

  describe("Manual Review Audit Verification (Acceptance Criteria)", () => {
    test("all stored artifacts and committed evidence logs contain zero raw secrets or PII", () => {
      const rootDir = resolve(import.meta.dir, "../..");
      const dirsToAudit = [
        resolve(rootDir, "artifacts"),
        resolve(rootDir, "evidence/discovery"),
        resolve(rootDir, "evidence/replay-error"),
      ];

      const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
      const creditCardPattern = /\b(?:\d{4}[- ]?){3}\d{4}\b/;
      const secretPattern = /\b(?:sk-[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9._-]+)\b/;

      for (const dir of dirsToAudit) {
        if (!existsSync(dir)) continue;

        const scanDir = (currentPath: string) => {
          const entries = readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(currentPath, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else if (entry.name.endsWith(".json") || entry.name.endsWith(".md")) {
              const content = readFileSync(fullPath, "utf-8");
              expect(ssnPattern.test(content)).toBe(false);
              expect(creditCardPattern.test(content)).toBe(false);
              expect(secretPattern.test(content)).toBe(false);
            }
          }
        };

        scanDir(dir);
      }
    });
  });
});
