import { describe, expect, test } from "bun:test";
import { validateArtifact } from "../../src/artifact/artifact.validator";
import { buildArtifact } from "../../src/artifact/compiler";

describe("Artifact Schema & Validation", () => {
  test("accepts a valid canonical artifact", () => {
    const artifact = buildArtifact({
      id: "test.capability",
      name: "Test Capability",
      description: "A test automation workflow",
      target: {
        appId: "test-app",
        entryUrl: "http://localhost:3000",
        allowedDomains: ["localhost"],
      },
      inputs: {
        userId: {
          type: "string",
          description: "User ID",
          required: true,
        },
      },
      steps: [
        {
          id: "step_1",
          description: "Fill user input",
          action: {
            type: "fill",
            valueTemplate: "{{inputs.userId}}",
          },
          targeting: {
            semantic: { role: "textbox", name: "User" },
          },
        },
      ],
      checkpoint: {
        successCondition: {
          assertion: { type: "url_matches", expectedValue: "/dashboard" },
          timeoutMs: 3000,
        },
        businessOutcomes: [],
      },
    });

    const report = validateArtifact(artifact);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  test("rejects artifact with undeclared input parameter references", () => {
    const invalidArtifact = {
      schemaVersion: "1.0.0",
      id: "invalid.param",
      name: "Invalid",
      description: "Invalid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: {
        appId: "app",
        entryUrl: "http://localhost",
        allowedDomains: ["localhost"],
      },
      inputs: {}, // No inputs declared
      steps: [
        {
          id: "step_1",
          description: "Uses undeclared param",
          action: {
            type: "fill",
            valueTemplate: "{{inputs.missingParam}}", // Undeclared!
          },
          targeting: { semantic: { role: "textbox" } },
        },
      ],
      checkpoint: {
        successCondition: {
          assertion: { type: "url_matches" },
          timeoutMs: 1000,
        },
        businessOutcomes: [],
      },
    };

    const report = validateArtifact(invalidArtifact);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.message.includes("missingParam"))).toBe(true);
  });

  test("rejects interactive action missing targeting strategy", () => {
    const invalid = {
      schemaVersion: "1.0.0",
      id: "missing.targeting",
      name: "Missing Targeting",
      description: "Invalid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: { appId: "app", entryUrl: "http://localhost", allowedDomains: ["localhost"] },
      inputs: {},
      steps: [
        {
          id: "step_click",
          description: "Click without target",
          action: { type: "click" }, // missing targeting!
        },
      ],
      checkpoint: {
        successCondition: { assertion: { type: "url_matches" }, timeoutMs: 1000 },
        businessOutcomes: [],
      },
    };

    const report = validateArtifact(invalid);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.message.includes("requires a targeting strategy"))).toBe(
      true,
    );
  });
});
