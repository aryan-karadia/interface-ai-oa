import { describe, expect, test } from "bun:test";
import { compileDiscoveryEvidence, type DiscoveryRunEvidence } from "../../src/artifact/compiler";
import { validateArtifact } from "../../src/artifact/artifact.validator";

describe("T2.2: Discovery -> Artifact Compiler", () => {
  const sampleEvidence: DiscoveryRunEvidence = {
    appId: "legacy-core-portal",
    entryUrl: "http://localhost:3000/portal/search",
    allowedDomains: ["localhost"],
    goal: "Look up member 10042 and extract balance",
    recordedSteps: [
      {
        step: 1,
        thought: "Navigate to the portal search page",
        action: { type: "navigate", url: "http://localhost:3000/portal/search" },
        success: true,
      },
      {
        step: 2,
        thought: "Failed attempt clicking wrong header",
        action: { type: "click" },
        targeting: { structural: { css: "#wrong_header" } },
        success: false, // Exploratory failure, should be pruned
      },
      {
        step: 3,
        thought: "Locate Member ID field and type 10042",
        action: { type: "fill", valueTemplate: "10042" },
        targeting: {
          semantic: { role: "textbox", name: "Member ID" },
          anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" },
          structural: { css: "#ctl00_txtMemberId" },
        },
        success: true,
      },
      {
        step: 4,
        thought: "Click Search button",
        action: { type: "click" },
        targeting: {
          semantic: { role: "button", name: "Search", exact: true },
          structural: { css: "#ctl00_btnSearch" },
        },
        success: true,
      },
    ],
    declaredInputs: {
      memberId: {
        type: "string",
        value: "10042",
        description: "Enterprise Member ID",
        sensitive: false,
      },
    },
    observedOutputs: {
      accountBalance: {
        type: "string",
        description: "Current member account balance",
        selector: {
          structural: { css: "#ctl00_gridMemberDetails tr td:last-child" },
        },
      },
    },
    checkpointAssertion: {
      type: "element_visible",
      targeting: {
        structural: { css: "#ctl00_gridMemberDetails" },
      },
    },
    businessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "Record does not exist in backend database",
        detection: {
          type: "text_matches",
          targeting: { structural: { css: "#ctl00_lblStatusMessage" } },
          pattern: "No active member records found",
        },
      },
    ],
  };

  test("compiles discovery evidence into a valid, decoupled ArtifactSpec", () => {
    const artifact = compileDiscoveryEvidence(sampleEvidence);

    // Schema validation passes
    const report = validateArtifact(artifact);
    expect(report.valid).toBe(true);
    expect(artifact.schemaVersion).toBe("1.0.0");
    expect(artifact.target.appId).toBe("legacy-core-portal");
  });

  test("parameterizes dynamic input values into template expressions", () => {
    const artifact = compileDiscoveryEvidence(sampleEvidence);

    // Inputs declared with types
    expect(artifact.inputs).toBeDefined();
    expect(artifact.inputs?.memberId).toBeDefined();
    expect(artifact.inputs?.memberId.type).toBe("string");
    expect(artifact.inputs?.memberId.description).toBe("Enterprise Member ID");

    // The fill step action should now use parameter template {{inputs.memberId}} instead of raw "10042"
    const fillStep = artifact.steps.find((s) => s.action.type === "fill");
    expect(fillStep).toBeDefined();
    if (fillStep && fillStep.action.type === "fill") {
      expect(fillStep.action.valueTemplate).toBe("{{inputs.memberId}}");
    }
  });

  test("prunes failed exploratory trial-and-error steps from the compiled artifact", () => {
    const artifact = compileDiscoveryEvidence(sampleEvidence);

    // Initial evidence had 4 steps (including 1 failed step). Compiled artifact must prune the failed step.
    const stepActions = artifact.steps.map((s) => s.action.type);
    expect(stepActions).not.toContain("wrong_header");
    expect(artifact.steps.find((s) => s.description.includes("Failed attempt"))).toBeUndefined();
    expect(artifact.steps.length).toBe(3); // navigate, fill, click
  });

  test("synthesizes typed output definitions mapped to the extraction source step", () => {
    const artifact = compileDiscoveryEvidence(sampleEvidence);

    expect(artifact.outputs).toBeDefined();
    expect(artifact.outputs?.accountBalance).toBeDefined();
    expect(artifact.outputs?.accountBalance.type).toBe("string");
    expect(artifact.outputs?.accountBalance.selector.structural?.css).toBe(
      "#ctl00_gridMemberDetails tr td:last-child"
    );
    // Source step ID should point to a valid step in the artifact
    const sourceStepId = artifact.outputs?.accountBalance.sourceStepId;
    expect(sourceStepId).toBeDefined();
    expect(artifact.steps.some((s) => s.id === sourceStepId)).toBe(true);
  });

  test("synthesizes checkpoint success conditions and business outcomes", () => {
    const artifact = compileDiscoveryEvidence(sampleEvidence);

    expect(artifact.checkpoint.successCondition.assertion.type).toBe("element_visible");
    expect(
      artifact.checkpoint.successCondition.assertion.targeting?.structural?.css
    ).toBe("#ctl00_gridMemberDetails");

    expect(artifact.checkpoint.businessOutcomes).toHaveLength(1);
    expect(artifact.checkpoint.businessOutcomes?.[0].code).toBe("MEMBER_NOT_FOUND");
    expect(artifact.checkpoint.businessOutcomes?.[0].detection.pattern).toBe(
      "No active member records found"
    );
  });

  test("rejects or throws when evidence has no successful executable steps", () => {
    const emptyEvidence: DiscoveryRunEvidence = {
      appId: "test-app",
      entryUrl: "http://localhost/test",
      allowedDomains: ["localhost"],
      goal: "Impossible goal",
      recordedSteps: [
        {
          step: 1,
          action: { type: "click" },
          success: false,
        },
      ],
    };

    expect(() => compileDiscoveryEvidence(emptyEvidence)).toThrow(
      /Cannot compile artifact: evidence contains no successful steps/i
    );
  });
});
