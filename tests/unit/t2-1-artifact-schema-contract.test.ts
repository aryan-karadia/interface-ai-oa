import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateArtifact } from "../../src/artifact/artifact.validator";
import { buildArtifact } from "../../src/artifact/compiler";

describe("T2.1: Artifact Schema Contract & ADR Defense", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const adrPath = resolve(rootDir, "docs/adr/ADR-002-artifact-schema-design.md");
  const jsonSchemaPath = resolve(rootDir, "schemas/artifact.schema.json");

  test("ADR-002 exists and thoroughly defends the artifact schema shape", () => {
    expect(existsSync(adrPath)).toBe(true);
    const content = readFileSync(adrPath, "utf-8");

    // Key required architectural sections
    expect(content).toContain("## Status");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");

    // Detailed schema requirements
    expect(content).toContain("schemaVersion");
    expect(content).toContain("TargetingStrategy");
    expect(content).toContain("semantic");
    expect(content).toContain("anchor");
    expect(content).toContain("structural");
    expect(content).toContain("visualFallback");
    expect(content).toContain("checkpoint");
    expect(content).toContain("businessOutcomes");
    expect(content).toContain("Alternatives Considered");
  });

  test("formal JSON Schema file exists for external tooling validation", () => {
    expect(existsSync(jsonSchemaPath)).toBe(true);
    const rawSchema = JSON.parse(readFileSync(jsonSchemaPath, "utf-8"));
    expect(rawSchema.$schema).toBeDefined();
    expect(rawSchema.properties.schemaVersion).toBeDefined();
    expect(rawSchema.properties.steps).toBeDefined();
    expect(rawSchema.properties.checkpoint).toBeDefined();
  });

  test("artifact schema enforces typed contract, ordered steps, and checkpoints", () => {
    const validSpec = buildArtifact({
      id: "acme.member.profile_lookup",
      name: "Member Profile Lookup",
      description: "Looks up member profile and extracts tier",
      target: {
        appId: "legacy-core-portal",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
      },
      inputs: {
        memberId: {
          type: "string",
          description: "Enterprise member identifier",
          required: true,
          sensitive: false,
        },
      },
      outputs: {
        planTier: {
          type: "string",
          description: "Insurance plan tier",
          sourceStepId: "step_2_search",
          selector: { structural: { css: "#ctl00_out_planTier" } },
        },
      },
      steps: [
        {
          id: "step_1_input",
          description: "Fill member ID field",
          action: { type: "fill", valueTemplate: "{{inputs.memberId}}" },
          targeting: {
            semantic: { role: "textbox", name: "Member ID" },
            anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" },
          },
        },
        {
          id: "step_2_search",
          description: "Click Search button",
          action: { type: "click" },
          targeting: {
            semantic: { name: "Search" },
            structural: { css: "#ctl00_MainContent_btnSearch_329a" },
          },
        },
      ],
      checkpoint: {
        successCondition: {
          assertion: {
            type: "element_visible",
            targeting: { structural: { css: "#ctl00_gridMemberDetails" } },
          },
          timeoutMs: 5000,
        },
        businessOutcomes: [
          {
            code: "MEMBER_NOT_FOUND",
            description: "No member found with matching ID",
            detection: {
              type: "text_matches",
              targeting: { structural: { css: "#ctl00_lblStatusMessage" } },
              pattern: "No active member records found",
            },
          },
        ],
      },
    });

    const report = validateArtifact(validSpec);
    expect(report.valid).toBe(true);
    expect(report.artifact?.schemaVersion).toBe("1.0.0");
    expect(report.artifact?.steps).toHaveLength(2);
  });
});
