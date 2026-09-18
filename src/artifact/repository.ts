import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArtifactSpec } from "./artifact.schema";
import { validateArtifact } from "./artifact.validator";

export interface StorageAdapter {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  writeFileSync(path: string, data: string, encoding?: string): void;
  readFileSync(path: string, encoding?: string): string;
  readdirSync(path: string): string[];
}

export const defaultStorageAdapter: StorageAdapter = {
  existsSync,
  mkdirSync: (p, o) => mkdirSync(p, o),
  writeFileSync: (p, d, enc) => writeFileSync(p, d, (enc || "utf-8") as any),
  readFileSync: (p, enc) => readFileSync(p, { encoding: (enc || "utf-8") as BufferEncoding }),
  readdirSync: (p) => readdirSync(p).map((e) => (typeof e === "string" ? e : (e as any).name)),
};

export class MemoryStorageAdapter implements StorageAdapter {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  constructor() {
    this.dirs.add("/");
  }

  private normalize(path: string): string {
    return resolve("/", path).replace(/\\/g, "/");
  }

  existsSync(path: string): boolean {
    const norm = this.normalize(path);
    return this.files.has(norm) || this.dirs.has(norm);
  }

  mkdirSync(path: string, _options?: { recursive?: boolean }): void {
    const norm = this.normalize(path);
    const parts = norm.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += `/${p}`;
      this.dirs.add(cur);
    }
  }

  writeFileSync(path: string, data: string): void {
    const norm = this.normalize(path);
    const lastSlash = norm.lastIndexOf("/");
    const parent = lastSlash > 0 ? norm.substring(0, lastSlash) : "/";
    this.mkdirSync(parent);
    this.files.set(norm, data);
  }

  readFileSync(path: string): string {
    const norm = this.normalize(path);
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  readdirSync(path: string): string[] {
    const norm = this.normalize(path).replace(/\/$/, "");
    const prefix = norm === "/" ? "/" : `${norm}/`;
    const entries = new Set<string>();

    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && f !== norm) {
        const rest = f.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.add(name);
      }
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && d !== norm) {
        const rest = d.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.add(name);
      }
    }
    return Array.from(entries);
  }
}

export interface SaveArtifactOptions {
  version?: string;
  tags?: string[];
}

export interface SaveArtifactResult {
  jsonPath: string;
  markdownPath: string;
  version: string;
}

export interface CapabilitySummary {
  appId: string;
  id: string;
  name: string;
  description: string;
  versions: string[];
  latestVersion: string;
}

export interface CapabilityManifest {
  appId: string;
  id: string;
  name: string;
  description: string;
  latestVersion: string;
  versions: string[];
  updatedAt: string;
}

/**
 * Repository for versioned, human-reviewable capability artifacts.
 * Strictly separates reusable capability specifications from execution runs.
 */
export class ArtifactRepository {
  private baseDir: string;
  private storage: StorageAdapter;

  constructor(baseDir: string = "artifacts", storage: StorageAdapter = defaultStorageAdapter) {
    this.storage = storage;
    this.baseDir = resolve(baseDir);
    if (!this.storage.existsSync(this.baseDir)) {
      this.storage.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Saves and strictly validates an ArtifactSpec.
   * Emits formatted JSON and human-reviewable Markdown companion spec.
   */
  async save(
    artifact: ArtifactSpec,
    options: SaveArtifactOptions = {},
  ): Promise<SaveArtifactResult> {
    const report = validateArtifact(artifact);
    if (!report.valid) {
      const errs = report.errors.map((e) => `[${e.path}] ${e.message}`).join(", ");
      throw new Error(`Artifact validation failed: ${errs}`);
    }

    const appId = artifact.target.appId;
    const capabilityId = artifact.id;
    const capabilityDir = join(this.baseDir, appId, capabilityId);

    if (!this.storage.existsSync(capabilityDir)) {
      this.storage.mkdirSync(capabilityDir, { recursive: true });
    }

    // Determine version
    const existingVersions = this.getExistingVersions(capabilityDir);
    let version = options.version?.replace(/^v/, "");

    if (!version) {
      if (existingVersions.length === 0) {
        version = "1.0.0";
      } else {
        const latest = existingVersions[existingVersions.length - 1];
        const parts = latest.split(".").map(Number);
        parts[2] = (parts[2] || 0) + 1;
        version = parts.join(".");
      }
    }

    const jsonFileName = `v${version}.json`;
    const mdFileName = `v${version}.md`;
    const jsonPath = join(capabilityDir, jsonFileName);
    const markdownPath = join(capabilityDir, mdFileName);

    // Save formatted JSON
    this.storage.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");

    // Save human-readable Markdown summary
    const markdownContent = generateArtifactMarkdown(artifact, version);
    this.storage.writeFileSync(markdownPath, markdownContent, "utf-8");

    // Update manifest
    const updatedVersions = Array.from(new Set([...existingVersions, version])).sort(compareSemver);
    const manifest: CapabilityManifest = {
      appId,
      id: capabilityId,
      name: artifact.name,
      description: artifact.description,
      latestVersion: version,
      versions: updatedVersions,
      updatedAt: new Date().toISOString(),
    };
    this.storage.writeFileSync(
      join(capabilityDir, "capability.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    return {
      jsonPath,
      markdownPath,
      version,
    };
  }

  /**
   * Loads an artifact by appId and id.
   * If version is omitted, loads the latest version.
   */
  async load(appId: string, id: string, version?: string): Promise<ArtifactSpec> {
    const capabilityDir = join(this.baseDir, appId, id);
    if (!this.storage.existsSync(capabilityDir)) {
      throw new Error(`Capability not found: ${appId}/${id}`);
    }

    let targetVersion = version?.replace(/^v/, "");
    if (!targetVersion) {
      const manifestPath = join(capabilityDir, "capability.json");
      if (this.storage.existsSync(manifestPath)) {
        const manifest: CapabilityManifest = JSON.parse(
          this.storage.readFileSync(manifestPath, "utf-8"),
        );
        targetVersion = manifest.latestVersion;
      } else {
        const versions = this.getExistingVersions(capabilityDir);
        if (versions.length === 0) {
          throw new Error(`No version files found for capability: ${appId}/${id}`);
        }
        targetVersion = versions[versions.length - 1];
      }
    }

    const jsonPath = join(capabilityDir, `v${targetVersion}.json`);
    if (!this.storage.existsSync(jsonPath)) {
      throw new Error(`Version v${targetVersion} not found for capability ${appId}/${id}`);
    }

    const raw = JSON.parse(this.storage.readFileSync(jsonPath, "utf-8"));
    const report = validateArtifact(raw);
    if (!report.valid) {
      throw new Error(
        `Saved artifact v${targetVersion} is corrupt: ${JSON.stringify(report.errors)}`,
      );
    }

    return raw as ArtifactSpec;
  }

  /**
   * Lists all stored capabilities across apps.
   */
  async list(appIdFilter?: string): Promise<CapabilitySummary[]> {
    const results: CapabilitySummary[] = [];
    if (!this.storage.existsSync(this.baseDir)) return results;

    const apps = this.storage.readdirSync(this.baseDir);

    for (const app of apps) {
      if (appIdFilter && app !== appIdFilter) continue;
      const appDir = join(this.baseDir, app);
      const capabilities = this.storage.readdirSync(appDir);

      for (const capId of capabilities) {
        const capDir = join(appDir, capId);
        const manifestPath = join(capDir, "capability.json");
        if (this.storage.existsSync(manifestPath)) {
          const manifest: CapabilityManifest = JSON.parse(
            this.storage.readFileSync(manifestPath, "utf-8"),
          );
          results.push({
            appId: manifest.appId,
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            versions: manifest.versions,
            latestVersion: manifest.latestVersion,
          });
        } else {
          const versions = this.getExistingVersions(capDir);
          if (versions.length > 0) {
            results.push({
              appId: app,
              id: capId,
              name: capId,
              description: "",
              versions,
              latestVersion: versions[versions.length - 1],
            });
          }
        }
      }
    }

    return results;
  }

  private getExistingVersions(dir: string): string[] {
    if (!this.storage.existsSync(dir)) return [];
    return this.storage
      .readdirSync(dir)
      .filter((f) => /^v\d+\.\d+\.\d+\.json$/.test(f))
      .map((f) => f.replace(/^v/, "").replace(/\.json$/, ""))
      .sort(compareSemver);
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Generates human-readable companion Markdown for an ArtifactSpec.
 */
export function generateArtifactMarkdown(artifact: ArtifactSpec, version = "1.0.0"): string {
  const lines: string[] = [];

  lines.push(`# Capability: ${artifact.name} (v${version})`);
  lines.push("");
  lines.push(`**ID:** \`${artifact.id}\`  `);
  lines.push(`**Target App:** \`${artifact.target.appId}\` (${artifact.target.entryUrl})  `);
  lines.push(`**Description:** ${artifact.description}  `);
  lines.push(`**Updated:** ${artifact.updatedAt}  `);
  lines.push("");

  // Inputs
  lines.push("## Input Parameters");
  lines.push("");
  const inputKeys = Object.keys(artifact.inputs || {});
  if (inputKeys.length === 0) {
    lines.push("*(No input parameters required)*");
  } else {
    lines.push("| Parameter | Type | Required | Sensitive | Description |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const [key, p] of Object.entries(artifact.inputs || {})) {
      lines.push(
        `| \`${key}\` | \`${p.type}\` | ${p.required ? "Yes" : "No"} | ${p.sensitive ? "🔒 Yes" : "No"} | ${p.description} |`,
      );
    }
  }
  lines.push("");

  // Outputs
  lines.push("## Output Extractions");
  lines.push("");
  const outputKeys = Object.keys(artifact.outputs || {});
  if (outputKeys.length === 0) {
    lines.push("*(No outputs extracted)*");
  } else {
    lines.push("| Output | Type | Source Step | Selector Strategy | Description |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const [key, out] of Object.entries(artifact.outputs || {})) {
      const sel = out.selector.structural?.css || out.selector.semantic?.name || "composite";
      lines.push(
        `| \`${key}\` | \`${out.type}\` | \`${out.sourceStepId}\` | \`${sel}\` | ${out.description} |`,
      );
    }
  }
  lines.push("");

  // Steps
  lines.push("## Execution Steps");
  lines.push("");
  artifact.steps.forEach((step, idx) => {
    lines.push(`### Step ${idx + 1}: \`${step.id}\` (${step.action.type})`);
    lines.push(`**Description:** ${step.description}`);
    if (step.action.type === "fill") {
      lines.push(`- **Value:** \`${step.action.valueTemplate}\``);
    } else if (step.action.type === "navigate") {
      lines.push(`- **URL:** \`${step.action.url}\``);
    }

    if (step.targeting) {
      lines.push("- **Targeting Fallback Priority:**");
      if (step.targeting.semantic) {
        lines.push(
          `  - **Tier 1 (Semantic):** role=\`${step.targeting.semantic.role || "*"}\`, name=\`${step.targeting.semantic.name}\``,
        );
      }
      if (step.targeting.anchor) {
        lines.push(
          `  - **Tier 2 (Anchor):** text=\`${step.targeting.anchor.anchorText}\`, dir=\`${step.targeting.anchor.direction}\``,
        );
      }
      if (step.targeting.structural) {
        lines.push(
          `  - **Tier 3 (Structural):** css=\`${step.targeting.structural.css || ""}\`, xpath=\`${step.targeting.structural.xpath || ""}\``,
        );
      }
      if (step.targeting.visualFallback) {
        lines.push(`  - **Tier 4 (Visual):** normalized bbox`);
      }
    }
    lines.push("");
  });

  // Checkpoints
  lines.push("## Checkpoints & Outcomes");
  lines.push("");
  lines.push(
    `- **Success Assertion:** \`${artifact.checkpoint.successCondition.assertion.type}\` (timeout: ${artifact.checkpoint.successCondition.timeoutMs ?? 5000}ms)`,
  );

  const outcomes = artifact.checkpoint.businessOutcomes || [];
  if (outcomes.length > 0) {
    lines.push("- **Business Outcomes (Domain Distinctions):**");
    for (const bo of outcomes) {
      lines.push(
        `  - \`${bo.code}\`: ${bo.description} (pattern: "${bo.detection.pattern || ""}")`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Computes semantic differences between two artifact versions.
 */
export function diffArtifacts(a: ArtifactSpec, b: ArtifactSpec): string {
  const lines: string[] = [];
  lines.push(`### Diff: ${a.id} (v${a.schemaVersion}) -> ${b.id} (v${b.schemaVersion})`);

  // Target diff
  if (a.target.entryUrl !== b.target.entryUrl) {
    lines.push(`- Target URL changed: ${a.target.entryUrl} -> ${b.target.entryUrl}`);
  }

  // Inputs diff
  const aInputs = Object.keys(a.inputs || {});
  const bInputs = Object.keys(b.inputs || {});
  const addedInputs = bInputs.filter((k) => !aInputs.includes(k));
  const removedInputs = aInputs.filter((k) => !bInputs.includes(k));

  if (addedInputs.length > 0) {
    lines.push(`+ Added Inputs: ${addedInputs.join(", ")}`);
  }
  if (removedInputs.length > 0) {
    lines.push(`- Removed Inputs: ${removedInputs.join(", ")}`);
  }

  // Steps diff
  lines.push("");
  lines.push("### Step Changes");
  const maxSteps = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < maxSteps; i++) {
    const sA = a.steps[i];
    const sB = b.steps[i];
    if (!sA && sB) {
      lines.push(`+ Step ${i + 1} added: [${sB.id}] ${sB.description} (${sB.action.type})`);
    } else if (sA && !sB) {
      lines.push(`- Step ${i + 1} removed: [${sA.id}] ${sA.description}`);
    } else if (sA && sB) {
      if (
        sA.id !== sB.id ||
        sA.action.type !== sB.action.type ||
        sA.description !== sB.description
      ) {
        lines.push(`~ Step ${i + 1} changed:`);
        lines.push(`    - Old: [${sA.id}] ${sA.description} (${sA.action.type})`);
        lines.push(`    + New: [${sB.id}] ${sB.description} (${sB.action.type})`);
      }
    }
  }

  return lines.join("\n");
}
