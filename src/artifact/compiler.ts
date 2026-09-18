import type {
  ArtifactSpec,
  ExecutionStep,
  ParameterDefinition,
  OutputDefinition,
  CheckpointSpec,
  StepAction,
  TargetingStrategy,
  StepAssertion,
  BusinessOutcomeDefinition,
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

export interface DiscoveryTraceStep {
  step: number;
  thought?: string;
  action: StepAction;
  targeting?: TargetingStrategy;
  success?: boolean;
  snapshot?: {
    url?: string;
    title?: string;
    domSnippet?: string;
    visibleText?: string[];
  };
}

export interface DeclaredInputEvidence {
  type: "string" | "number" | "boolean";
  value: string | number | boolean;
  description?: string;
  sensitive?: boolean;
  required?: boolean;
}

export interface ObservedOutputEvidence {
  type?: "string" | "number" | "boolean" | "object";
  description?: string;
  sourceStepId?: string;
  selector: TargetingStrategy;
  attribute?: string;
}

export interface DiscoveryRunEvidence {
  appId: string;
  entryUrl: string;
  allowedDomains: string[];
  goal: string;
  id?: string;
  name?: string;
  transcript?: Array<{
    step: number;
    thought: string;
    action?: string;
    result: string;
    timestamp?: string;
  }>;
  recordedSteps: DiscoveryTraceStep[];
  declaredInputs?: Record<string, DeclaredInputEvidence>;
  observedOutputs?: Record<string, ObservedOutputEvidence>;
  checkpointAssertion?: StepAssertion;
  businessOutcomes?: BusinessOutcomeDefinition[];
}

/**
 * Compiles raw discovery trace and evidence into a structured, decoupled ArtifactSpec.
 * - Prunes exploratory trial-and-error failures.
 * - Parameterizes dynamic inputs into {{inputs.key}} template expressions.
 * - Synthesizes typed output definitions bound to extraction steps.
 * - Configures robust multi-tier targeting and recovery policies.
 * - Generates checkpoint success conditions and business outcomes.
 */
export function compileDiscoveryEvidence(evidence: DiscoveryRunEvidence): ArtifactSpec {
  const successfulSteps = evidence.recordedSteps.filter((s) => s.success !== false);

  if (successfulSteps.length === 0) {
    throw new Error("Cannot compile artifact: evidence contains no successful steps");
  }

  // 1. Process and parameterize inputs
  const inputs: Record<string, ParameterDefinition> = {};
  const replacementMap: Array<{ searchStr: string; templateVar: string }> = [];

  if (evidence.declaredInputs) {
    for (const [key, inputEvidence] of Object.entries(evidence.declaredInputs)) {
      inputs[key] = {
        type: inputEvidence.type,
        description: inputEvidence.description || `Input parameter ${key}`,
        required: inputEvidence.required ?? true,
        sensitive: inputEvidence.sensitive ?? false,
      };
      if (inputEvidence.value !== undefined && inputEvidence.value !== "") {
        replacementMap.push({
          searchStr: String(inputEvidence.value),
          templateVar: `{{inputs.${key}}}`,
        });
      }
    }
  }

  // 2. Build and parameterize execution steps
  const compiledSteps: ExecutionStep[] = successfulSteps.map((step, idx) => {
    const stepId = `step_${idx + 1}_${step.action.type}`;
    let parameterizedAction = { ...step.action };

    if (parameterizedAction.type === "fill" && parameterizedAction.valueTemplate) {
      let templated = parameterizedAction.valueTemplate;
      for (const { searchStr, templateVar } of replacementMap) {
        if (templated === searchStr || templated.includes(searchStr)) {
          templated = templated.replaceAll(searchStr, templateVar);
        }
      }
      parameterizedAction = {
        ...parameterizedAction,
        valueTemplate: templated,
      };
    }

    return {
      id: stepId,
      description: step.thought || `Execute ${step.action.type}`,
      action: parameterizedAction,
      targeting: step.targeting,
      recovery: {
        maxRetries: 2,
        retryDelayMs: 1000,
        dismissOverlaysBeforeRetry: true,
      },
    };
  });

  // 3. Process outputs
  const outputs: Record<string, OutputDefinition> = {};
  if (evidence.observedOutputs) {
    const lastStepId = compiledSteps[compiledSteps.length - 1]?.id || "step_1_navigate";
    for (const [key, outEvidence] of Object.entries(evidence.observedOutputs)) {
      // Find matching source step or link to final action step
      const sourceStepId =
        outEvidence.sourceStepId && compiledSteps.some((s) => s.id === outEvidence.sourceStepId)
          ? outEvidence.sourceStepId
          : lastStepId;

      outputs[key] = {
        type: outEvidence.type ?? "string",
        description: outEvidence.description || `Output ${key}`,
        sourceStepId,
        selector: outEvidence.selector,
        attribute: outEvidence.attribute ?? "innerText",
      };
    }
  }

  // 4. Construct Checkpoint
  const successAssertion: StepAssertion = evidence.checkpointAssertion ?? {
    type: "url_matches",
    expectedValue: evidence.entryUrl,
    timeoutMs: 5000,
  };

  const checkpoint: CheckpointSpec = {
    successCondition: {
      assertion: successAssertion,
      timeoutMs: 5000,
    },
    businessOutcomes: evidence.businessOutcomes ?? [],
  };

  // 5. Build and validate canonical artifact
  const sanitizedId = (evidence.id || `artifact_${evidence.appId}_${Date.now()}`)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");

  return buildArtifact({
    id: sanitizedId,
    name: evidence.name || `Automated ${evidence.goal}`,
    description: evidence.goal,
    target: {
      appId: evidence.appId,
      entryUrl: evidence.entryUrl,
      allowedDomains: evidence.allowedDomains,
    },
    inputs,
    outputs,
    steps: compiledSteps,
    checkpoint,
  });
}
