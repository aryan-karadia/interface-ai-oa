import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import {
  ArtifactRepository,
  diffArtifacts,
  MemoryStorageAdapter,
} from "../../src/artifact/repository";

describe("T2.3: Artifact Storage & Versioning", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const testStorageDir = "/virtual/artifacts/test-repo";
  const docPath = resolve(rootDir, "docs/adr/0008-artifact-storage-and-versioning-layout.md");

  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  const sampleArtifact: ArtifactSpec = {
    schemaVersion: "1.0.0",
    id: "member_lookup",
    name: "Member Lookup",
    description: "Looks up member account details in LegacyCore Portal",
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
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
      accountBalance: {
        type: "string",
        description: "Current member balance",
        sourceStepId: "step_2_click",
        selector: { structural: { css: "#ctl00_gridMemberDetails td:last-child" } },
      },
    },
    steps: [
      {
        id: "step_1_fill",
        description: "Fill member ID into search field",
        action: { type: "fill", valueTemplate: "{{inputs.memberId}}" },
        targeting: {
          semantic: { role: "textbox", name: "Member ID" },
          anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" },
        },
      },
      {
        id: "step_2_click",
        description: "Click Search button",
        action: { type: "click" },
        targeting: {
          semantic: { role: "button", name: "Search", exact: true },
          structural: { css: "#ctl00_btnSearch" },
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
          description: "Member does not exist",
          detection: {
            type: "text_matches",
            targeting: { structural: { css: "#ctl00_lblStatusMessage" } },
            pattern: "No active member records found",
          },
        },
      ],
    },
  };

  test("ADR-0008 documents storage layout, separation of artifacts vs runs, and versioning", () => {
    expect(existsSync(docPath)).toBe(true);
    const docContent = readFileSync(docPath, "utf-8");

    expect(docContent).toContain("Storage Layout");
    expect(docContent).toContain("Separation of Artifacts and Runs");
    expect(docContent).toContain("Versioning Strategy");
    expect(docContent).toContain("Human Reviewability & Diffability");
  });

  test("saves versioned artifact with formatted JSON and human-readable Markdown", async () => {
    const repo = new ArtifactRepository(testStorageDir, storage);
    const saveResult = await repo.save(sampleArtifact, { version: "1.0.0" });

    expect(saveResult.version).toBe("1.0.0");
    expect(storage.existsSync(saveResult.jsonPath)).toBe(true);
    expect(storage.existsSync(saveResult.markdownPath)).toBe(true);

    // Verify formatted JSON content is readable & indented
    const savedJson = storage.readFileSync(saveResult.jsonPath);
    expect(savedJson).toContain('  "schemaVersion": "1.0.0"');
    expect(savedJson).toContain('  "id": "member_lookup"');

    // Verify markdown summary content
    const savedMarkdown = storage.readFileSync(saveResult.markdownPath);
    expect(savedMarkdown).toContain("# Capability: Member Lookup (v1.0.0)");
    expect(savedMarkdown).toContain("`{{inputs.memberId}}`");
    expect(savedMarkdown).toContain("MEMBER_NOT_FOUND");
  });

  test("loads latest version or specified version correctly", async () => {
    const repo = new ArtifactRepository(testStorageDir, storage);

    // Save v1.0.0
    await repo.save(sampleArtifact, { version: "1.0.0" });

    // Save v1.1.0 with an extra step
    const updatedArtifact: ArtifactSpec = {
      ...sampleArtifact,
      steps: [
        ...sampleArtifact.steps,
        {
          id: "step_3_print",
          description: "Wait for results rendering",
          action: { type: "wait", timeoutMs: 1000 },
        },
      ],
    };
    await repo.save(updatedArtifact, { version: "1.1.0" });

    // Loading without version should yield latest (v1.1.0)
    const latest = await repo.load("legacy-core-portal", "member_lookup");
    expect(latest.steps.length).toBe(3);

    // Loading explicit v1.0.0
    const v1 = await repo.load("legacy-core-portal", "member_lookup", "1.0.0");
    expect(v1.steps.length).toBe(2);
  });

  test("lists stored capabilities and their available versions", async () => {
    const repo = new ArtifactRepository(testStorageDir, storage);
    await repo.save(sampleArtifact, { version: "1.0.0" });
    await repo.save({ ...sampleArtifact, description: "Updated v1.1.0" }, { version: "1.1.0" });

    const list = await repo.list();
    expect(list.length).toBe(1);
    expect(list[0].appId).toBe("legacy-core-portal");
    expect(list[0].id).toBe("member_lookup");
    expect(list[0].versions).toEqual(["1.0.0", "1.1.0"]);
    expect(list[0].latestVersion).toBe("1.1.0");
  });

  test("generates human-readable diff between two artifact versions", () => {
    const modifiedArtifact: ArtifactSpec = {
      ...sampleArtifact,
      steps: [
        sampleArtifact.steps[0],
        {
          id: "step_2_click_modified",
          description: "Click Search button with updated targeting",
          action: { type: "click" },
          targeting: {
            semantic: { role: "button", name: "Search Member" },
          },
        },
      ],
    };

    const diff = diffArtifacts(sampleArtifact, modifiedArtifact);
    expect(diff).toContain("Step Changes");
    expect(diff).toContain("step_2_click_modified");
  });

  test("rejects saving invalid artifacts violating schema or integrity", async () => {
    const repo = new ArtifactRepository(testStorageDir, storage);
    const invalidArtifact = {
      ...sampleArtifact,
      steps: [
        {
          id: "step_invalid",
          description: "Missing targeting on click",
          action: { type: "click" as const },
        },
      ],
    };

    await expect(repo.save(invalidArtifact)).rejects.toThrow(/Artifact validation failed/i);
  });
});
