import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ArtifactSpec, ExecutionStep, StepAction } from "../artifact/artifact.schema";
import type { SessionCoordinator } from "../escalation/session-coordinator";
import type { IGuardrailService } from "../guardrail/guardrail.interface";
import { Redactor } from "../guardrail/redactor";
import type { Surface } from "../surface/surface.interface";
import { LocatorEngine } from "./locator-engine";
import type {
  ExecutionTelemetry,
  ReplayHardFailureResult,
  ReplayResult,
  StepTelemetry,
} from "./result-contract";

export interface ReplayOptions {
  inputs?: Record<string, unknown>;
  timeoutMs?: number;
  stopOnRecoverable?: boolean;
  evidenceDir?: string;
}

/**
 * Deterministic Replay Executor.
 * Executes an Artifact against a Surface without any LLM in the loop.
 */
export class ReplayExecutor {
  constructor(
    private surface: Surface,
    private guardrail: IGuardrailService,
    private escalation?: SessionCoordinator,
  ) {}

  async execute(artifact: ArtifactSpec, options: ReplayOptions = {}): Promise<ReplayResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const runId = `replay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const stepMetrics: StepTelemetry[] = [];
    const extractedOutputs: Record<string, unknown> = {};

    const finish = async (result: ReplayResult): Promise<ReplayResult> => {
      if (options.evidenceDir) {
        await this.flushEvidence(options.evidenceDir, runId, artifact, resolvedInputs, result);
      }
      return result;
    };

    // 1. Validate & Interpolate Input Parameters
    const resolvedInputs: Record<string, unknown> = { ...(options.inputs ?? {}) };
    for (const [key, def] of Object.entries(artifact.inputs ?? {})) {
      let val = resolvedInputs[key];
      if (val === undefined) {
        if (def.default !== undefined) {
          val = def.default;
          resolvedInputs[key] = val;
        } else if (def.required) {
          return finish(
            this.createHardFailure(
              artifact,
              runId,
              startedAt,
              startTime,
              stepMetrics,
              "SCHEMA_MISMATCH",
              `Missing required input parameter: "${key}"`,
            ),
          );
        }
      }

      if (val !== undefined) {
        if (def.type === "number" && typeof val !== "number") {
          return finish(
            this.createHardFailure(
              artifact,
              runId,
              startedAt,
              startTime,
              stepMetrics,
              "SCHEMA_MISMATCH",
              `Input parameter "${key}" expected type "number", received "${typeof val}"`,
            ),
          );
        }
        if (def.type === "boolean" && typeof val !== "boolean") {
          return finish(
            this.createHardFailure(
              artifact,
              runId,
              startedAt,
              startTime,
              stepMetrics,
              "SCHEMA_MISMATCH",
              `Input parameter "${key}" expected type "boolean", received "${typeof val}"`,
            ),
          );
        }
        if (def.validationRegex) {
          const regex = new RegExp(def.validationRegex);
          if (!regex.test(String(val))) {
            return finish(
              this.createHardFailure(
                artifact,
                runId,
                startedAt,
                startTime,
                stepMetrics,
                "SCHEMA_MISMATCH",
                `Input parameter "${key}" failed validationRegex: ${def.validationRegex}`,
              ),
            );
          }
        }
      }
    }

    try {
      // 2. Execute Steps Sequentially
      for (let i = 0; i < artifact.steps.length; i++) {
        const step = artifact.steps[i];
        const stepResult = await this.executeStep(artifact, step, resolvedInputs, stepMetrics);

        if (stepResult.status !== "STEP_SUCCESS") {
          if (stepResult.status === "GUARDRAIL_VIOLATION") {
            return finish(
              this.createHardFailure(
                artifact,
                runId,
                startedAt,
                startTime,
                stepMetrics,
                "GUARDRAIL_VIOLATION",
                stepResult.error || "Guardrail violation blocked execution",
                step.id,
              ),
            );
          }

          if (stepResult.status === "RECOVERABLE") {
            if (options.stopOnRecoverable) {
              return finish({
                status: "RECOVERABLE_RUNTIME_CONDITION",
                artifactId: artifact.id,
                artifactVersion: artifact.schemaVersion,
                failedStepId: step.id,
                retryAttempt: stepResult.retries,
                maxRetries: step.recovery?.maxRetries ?? 2,
                reason: "ELEMENT_OCCLUDED",
                suggestedAction: "DISMISS_OVERLAY_AND_RETRY",
                telemetry: this.createTelemetry(runId, startedAt, startTime, stepMetrics),
              });
            }

            // Attempt human escalation if coordinator available
            if (this.escalation) {
              const _resolution = await this.escalation.requestEscalation({
                reason: "TARGETING_EXHAUSTED",
                message: `Failed step "${step.id}": ${stepResult.error}`,
                stepId: step.id,
                stepIndex: i + 1,
                goal: artifact.name,
                suggestedAction: "Please resolve the element or modal in the browser window",
              });
              // Retry once after human handoff
              const retryAfterHandoff = await this.executeStep(
                artifact,
                step,
                resolvedInputs,
                stepMetrics,
              );
              if (retryAfterHandoff.status !== "STEP_SUCCESS") {
                return finish(
                  this.createHardFailure(
                    artifact,
                    runId,
                    startedAt,
                    startTime,
                    stepMetrics,
                    "TARGETING_EXHAUSTED",
                    `Step "${step.id}" failed after operator handoff: ${retryAfterHandoff.error}`,
                    step.id,
                  ),
                );
              }
            } else {
              return finish(
                this.createHardFailure(
                  artifact,
                  runId,
                  startedAt,
                  startTime,
                  stepMetrics,
                  "TARGETING_EXHAUSTED",
                  `Targeting exhausted on step "${step.id}": ${stepResult.error}`,
                  step.id,
                ),
              );
            }
          }

          if (stepResult.status === "FATAL") {
            return finish(
              this.createHardFailure(
                artifact,
                runId,
                startedAt,
                startTime,
                stepMetrics,
                "UNHANDLED_EXCEPTION",
                stepResult.error || "Fatal step failure",
                step.id,
              ),
            );
          }
        }

        // Output extraction step
        if (step.action.type === "extract") {
          const val = await this.extractValue(step.action.outputKey, step, artifact);
          if (val !== undefined) {
            extractedOutputs[step.action.outputKey] = val;
          }
        }
      }

      // 3. Evaluate Checkpoint: Distinguish Business Outcomes vs Success
      const checkpointResult = await this.evaluateCheckpoint(artifact, resolvedInputs);

      if (checkpointResult.type === "BUSINESS_OUTCOME") {
        return finish({
          status: "BUSINESS_OUTCOME",
          artifactId: artifact.id,
          artifactVersion: artifact.schemaVersion,
          executionDurationMs: Date.now() - startTime,
          outcomeCode: checkpointResult.outcomeCode,
          description: checkpointResult.description,
          evidence: checkpointResult.evidence,
          telemetry: this.createTelemetry(runId, startedAt, startTime, stepMetrics),
        });
      }

      if (checkpointResult.type === "SUCCESS") {
        // Collect any declared outputs not yet extracted
        for (const [outputKey, outputDef] of Object.entries(artifact.outputs ?? {})) {
          if (extractedOutputs[outputKey] === undefined) {
            const el = await LocatorEngine.resolve(this.surface, outputDef.selector);
            if (el) {
              const text =
                outputDef.attribute && outputDef.attribute !== "innerText"
                  ? await el.element.getAttribute(outputDef.attribute)
                  : await el.element.getText();
              extractedOutputs[outputKey] = text;
            }
          }
        }

        return finish({
          status: "SUCCESS",
          artifactId: artifact.id,
          artifactVersion: artifact.schemaVersion,
          executionDurationMs: Date.now() - startTime,
          stepsExecuted: artifact.steps.length,
          outputs: extractedOutputs,
          checkpointValidation: {
            matchedAssertion: checkpointResult.matchedAssertion,
            timestamp: new Date().toISOString(),
          },
          telemetry: this.createTelemetry(runId, startedAt, startTime, stepMetrics),
        });
      }

      // If checkpoint failed both success and known business outcomes
      return finish(
        this.createHardFailure(
          artifact,
          runId,
          startedAt,
          startTime,
          stepMetrics,
          "TARGETING_EXHAUSTED",
          "Neither success checkpoint condition nor any registered business outcome was satisfied",
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return finish(
        this.createHardFailure(
          artifact,
          runId,
          startedAt,
          startTime,
          stepMetrics,
          "UNHANDLED_EXCEPTION",
          message,
        ),
      );
    }
  }

  private async flushEvidence(
    evidenceDir: string,
    runId: string,
    artifact: ArtifactSpec,
    inputs: Record<string, unknown>,
    result: ReplayResult,
  ): Promise<void> {
    try {
      if (!existsSync(evidenceDir)) {
        mkdirSync(evidenceDir, { recursive: true });
      }

      // 1. run-manifest.json
      const manifest = Redactor.redactDeep({
        runId: result.telemetry?.runId,
        status: result.status,
        artifactId: result.artifactId,
        artifactVersion: result.artifactVersion,
        inputs,
        durationMs:
          "executionDurationMs" in result
            ? result.executionDurationMs
            : (result.telemetry?.totalDurationMs ?? 0),
        startedAt: result.telemetry?.startedAt,
        completedAt: result.telemetry?.completedAt,
      });
      writeFileSync(
        join(evidenceDir, "run-manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );

      // 2. replay-result.json
      const sanitizedResult = Redactor.redactDeep(result);
      writeFileSync(
        join(evidenceDir, "replay-result.json"),
        JSON.stringify(sanitizedResult, null, 2),
        "utf-8",
      );

      // 3. dom-snapshot.json and screenshot-failure.jpeg
      const snapshot = await this.surface.perceive().catch(() => null);
      if (snapshot) {
        const { screenshotBase64, ...domData } = snapshot;
        const sanitizedDom = Redactor.redactDeep(domData);
        writeFileSync(
          join(evidenceDir, "dom-snapshot.json"),
          JSON.stringify(sanitizedDom, null, 2),
          "utf-8",
        );

        if (screenshotBase64) {
          writeFileSync(
            join(evidenceDir, "screenshot-failure.jpeg"),
            Buffer.from(screenshotBase64, "base64"),
          );
        }
      }
    } catch {
      // Best-effort evidence capture
    }
  }

  private async executeStep(
    artifact: ArtifactSpec,
    step: ExecutionStep,
    inputs: Record<string, unknown>,
    stepMetrics: StepTelemetry[],
  ): Promise<{
    status: "STEP_SUCCESS" | "GUARDRAIL_VIOLATION" | "RECOVERABLE" | "FATAL";
    error?: string;
    retries: number;
  }> {
    const stepStart = Date.now();
    const interpolatedAction = this.interpolateAction(step.action, inputs);

    // Pre-action Guardrail Check
    const currentSnapshot = await this.surface.perceive().catch(() => ({
      url: artifact.target.entryUrl,
    }));
    const check = this.guardrail.checkAction(
      interpolatedAction,
      currentSnapshot.url,
      step.targeting,
    );
    if (!check.allowed) {
      stepMetrics.push({
        stepId: step.id,
        actionType: step.action.type,
        durationMs: Date.now() - stepStart,
        retries: 0,
        success: false,
        error: check.reason,
      });
      return { status: "GUARDRAIL_VIOLATION", error: check.reason, retries: 0 };
    }

    const maxRetries = step.recovery?.maxRetries ?? 1;
    let attempts = 0;
    let lastError: string | undefined;

    while (attempts <= maxRetries) {
      attempts++;
      let targetingTier: "semantic" | "anchor" | "structural" | "visualFallback" | undefined;

      // If step targets an element
      if (step.targeting) {
        const resolved = await LocatorEngine.resolve(this.surface, step.targeting);
        if (!resolved) {
          // Attempt recovery: dismiss overlay if enabled
          if (step.recovery?.dismissOverlaysBeforeRetry) {
            const dismissed = await this.surface.dismissOverlays();
            if (dismissed) {
              continue; // Retry after dismissing modal
            }
          }
          lastError = "Could not locate target element across any tier";
          continue;
        }
        targetingTier = resolved.tier;
      }

      // Execute action on surface
      const actResult = await this.surface.act(interpolatedAction, step.targeting);
      if (actResult.success) {
        stepMetrics.push({
          stepId: step.id,
          actionType: step.action.type,
          durationMs: Date.now() - stepStart,
          targetingTierUsed: targetingTier,
          retries: attempts - 1,
          success: true,
        });
        return { status: "STEP_SUCCESS", retries: attempts - 1 };
      }

      lastError = actResult.error;
      if (step.recovery?.dismissOverlaysBeforeRetry) {
        await this.surface.dismissOverlays();
      }
    }

    stepMetrics.push({
      stepId: step.id,
      actionType: step.action.type,
      durationMs: Date.now() - stepStart,
      retries: attempts - 1,
      success: false,
      error: lastError,
    });

    return { status: "RECOVERABLE", error: lastError, retries: attempts - 1 };
  }

  private async evaluateCheckpoint(
    artifact: ArtifactSpec,
    inputs: Record<string, unknown>,
  ): Promise<
    | { type: "SUCCESS"; matchedAssertion: string }
    | {
        type: "BUSINESS_OUTCOME";
        outcomeCode: string;
        description: string;
        evidence: { matchedDetectionType: string; detectedText?: string };
      }
    | { type: "FAILED" }
  > {
    const cp = artifact.checkpoint;

    // 1. First check if any known business outcome is visible
    for (const outcome of cp.businessOutcomes ?? []) {
      const { type, targeting, pattern } = outcome.detection;
      const targetResolved = await LocatorEngine.resolve(this.surface, targeting);
      if (targetResolved) {
        const text = await targetResolved.element.getText();
        if (!pattern || text.includes(pattern)) {
          return {
            type: "BUSINESS_OUTCOME",
            outcomeCode: outcome.code,
            description: outcome.description,
            evidence: {
              matchedDetectionType: type,
              detectedText: text,
            },
          };
        }
      }
    }

    // 2. Check primary success condition
    const { assertion } = cp.successCondition;
    let expectedVal = assertion.expectedValue;
    if (expectedVal) {
      expectedVal = this.interpolateString(expectedVal, inputs);
    }

    const holds = await this.surface.evaluateAssertion(
      assertion.type,
      expectedVal,
      assertion.targeting,
    );

    if (holds) {
      return {
        type: "SUCCESS",
        matchedAssertion: `${assertion.type}: ${expectedVal || "verified"}`,
      };
    }

    return { type: "FAILED" };
  }

  private async extractValue(
    outputKey: string,
    step: ExecutionStep,
    artifact: ArtifactSpec,
  ): Promise<unknown> {
    const outputDef = artifact.outputs?.[outputKey];
    if (outputDef) {
      const resolved = await LocatorEngine.resolve(this.surface, outputDef.selector);
      if (resolved) {
        return resolved.element.getText();
      }
    }
    if (step.targeting) {
      const resolved = await LocatorEngine.resolve(this.surface, step.targeting);
      if (resolved) {
        return resolved.element.getText();
      }
    }
    return undefined;
  }

  private interpolateAction(action: StepAction, inputs: Record<string, unknown>): StepAction {
    if (action.type === "fill") {
      return {
        ...action,
        valueTemplate: this.interpolateString(action.valueTemplate, inputs),
      };
    }
    if (action.type === "navigate") {
      return {
        ...action,
        url: this.interpolateString(action.url, inputs),
      };
    }
    return action;
  }

  private interpolateString(template: string, inputs: Record<string, unknown>): string {
    return template.replace(/\{\{\s*inputs\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const val = inputs[key];
      return val !== undefined ? String(val) : "";
    });
  }

  private createHardFailure(
    artifact: ArtifactSpec,
    runId: string,
    startedAt: string,
    startTime: number,
    stepMetrics: StepTelemetry[],
    category: ReplayHardFailureResult["category"],
    message: string,
    failedStepId?: string,
  ): ReplayHardFailureResult {
    return {
      status: "HARD_FAILURE",
      artifactId: artifact.id,
      artifactVersion: artifact.schemaVersion,
      failedStepId,
      category,
      message,
      telemetry: this.createTelemetry(runId, startedAt, startTime, stepMetrics),
    };
  }

  private createTelemetry(
    runId: string,
    startedAt: string,
    startTime: number,
    stepMetrics: StepTelemetry[],
  ): ExecutionTelemetry {
    return {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startTime,
      stepMetrics,
    };
  }
}
