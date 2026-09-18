import type {
  ArtifactSpec,
  ExecutionStep,
  ParameterDefinition,
  OutputDefinition,
  CheckpointSpec,
} from "./artifact.schema";
import { validateArtifact } from "./artifact.validator";

export interface BuildArtifactOptions {
  id: string;
  name: string;
  description: string;
  target: {
    appId: string;
    entryUrl: string;
    allowedDomains: string[];
  };
  inputs?: Record<string, ParameterDefinition>;
  outputs?: Record<string, OutputDefinition>;
  steps: ExecutionStep[];
  checkpoint: CheckpointSpec;
}

/**
 * Builds and strictly validates an ArtifactSpec.
 * Throws if the resulting artifact fails structural or semantic validation.
 */
export function buildArtifact(options: BuildArtifactOptions): ArtifactSpec {
  const timestamp = new Date().toISOString();
  const raw: ArtifactSpec = {
    schemaVersion: "1.0.0",
    id: options.id,
    name: options.name,
    description: options.description,
    createdAt: timestamp,
    updatedAt: timestamp,
    target: options.target,
    inputs: options.inputs ?? {},
    outputs: options.outputs ?? {},
    steps: options.steps,
    checkpoint: options.checkpoint,
  };

  const report = validateArtifact(raw);
  if (!report.valid) {
    const errorDetails = report.errors.map((e) => `[${e.path}] ${e.message}`).join(", ");
    throw new Error(`Artifact validation failed: ${errorDetails}`);
  }

  return raw;
}
