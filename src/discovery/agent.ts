import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactSpec } from "../artifact/artifact.schema";
import {
  compileDiscoveryEvidence,
  type DeclaredInputEvidence,
  type DiscoveryTraceStep,
  type ObservedOutputEvidence,
} from "../artifact/compiler";
import type { SessionCoordinator } from "../escalation/session-coordinator";
import type { IGuardrailService } from "../guardrail/guardrail.interface";
import { Redactor } from "../guardrail/redactor";
import type { StructuredLogger } from "../logging/structured-logger";
import type { Surface } from "../surface/surface.interface";
import type { DiscoveryContext, LLMClient } from "./llm-client.interface";

export interface DiscoveryOptions {
  goal: string;
  appId: string;
  entryUrl: string;
  allowedDomains: string[];
  maxSteps?: number;
  timeoutMs?: number;
  maxConsecutiveIdenticalActions?: number;
  evidenceDir?: string;
  declaredInputs?: Record<string, DeclaredInputEvidence>;
  observedOutputs?: Record<string, ObservedOutputEvidence>;
}

export interface DiscoveryRunResult {
  success: boolean;
  artifact?: ArtifactSpec;
  stepsTaken: number;
  transcript: Array<{
    step: number;
    thought: string;
    action?: string;
    result: string;
    timestamp?: string;
  }>;
  evidenceDir?: string;
  error?: string;
}

export class DiscoveryAgent {
  constructor(
    private surface: Surface,
    private llmClient: LLMClient,
    private guardrail: IGuardrailService,
    private coordinator?: SessionCoordinator,
    private logger?: StructuredLogger,
  ) {}

  async discover(options: DiscoveryOptions): Promise<DiscoveryRunResult> {
    const maxSteps = options.maxSteps ?? 10;
    const timeoutMs = options.timeoutMs ?? 120000;
    const maxConsecutiveIdentical = options.maxConsecutiveIdenticalActions ?? 3;
    const startTime = Date.now();

    const transcript: DiscoveryRunResult["transcript"] = [];
    const recordedSteps: DiscoveryTraceStep[] = [];
    const context: DiscoveryContext = {
      goal: options.goal,
      appId: options.appId,
      history: [],
    };

    // Ensure evidence directory exists if configured
    if (options.evidenceDir) {
      if (!existsSync(options.evidenceDir)) {
        mkdirSync(options.evidenceDir, { recursive: true });
      }
    }

    // Initial navigation
    await this.surface.navigate(options.entryUrl);
    recordedSteps.push({
      step: 0,
      thought: `Navigate to initial target URL`,
      action: { type: "navigate", url: options.entryUrl },
      success: true,
    });

    let currentStep = 1;
    let consecutiveIdenticalCount = 0;
    let lastActionFingerprint = "";

    while (currentStep <= maxSteps) {
      // Check Timeout Budget Stopping Condition
      if (Date.now() - startTime > timeoutMs) {
        this.flushEvidence(options.evidenceDir, transcript);
        return {
          success: false,
          stepsTaken: currentStep - 1,
          transcript,
          evidenceDir: options.evidenceDir,
          error: `Discovery stopped: timeout budget (${timeoutMs}ms) exceeded`,
        };
      }

      // 1. Observe (Perceive Surface)
      const snapshot = await this.surface.perceive();

      this.logger?.info(
        "discovery",
        "OBSERVE",
        `Captured page snapshot at ${snapshot.url}`,
        "Perceived current DOM state and accessibility tree",
        { step: currentStep, url: snapshot.url, title: snapshot.title },
      );

      // Capture Step Evidence: DOM snapshot and Screenshot
      if (options.evidenceDir) {
        const domPath = join(options.evidenceDir, `dom-snapshot-step-${currentStep}.json`);
        const sanitizedDom = Redactor.redactDeep({
          step: currentStep,
          url: snapshot.url,
          title: snapshot.title,
          visibleText: snapshot.visibleText,
          accessibilityTree: snapshot.accessibilityTree,
          timestamp: snapshot.timestamp,
        });
        writeFileSync(domPath, JSON.stringify(sanitizedDom, null, 2));

        if (snapshot.screenshotBase64) {
          const screenshotPath = join(options.evidenceDir, `screenshot-step-${currentStep}.jpeg`);
          writeFileSync(screenshotPath, Buffer.from(snapshot.screenshotBase64, "base64"));
        }
      }

      // 2. Decide (LLM generation)
      const decision = await this.llmClient.generateDecision(snapshot, context);

      this.logger?.info(
        "discovery",
        "DECIDE",
        `LLM proposed action: ${decision.action?.type ?? (decision.goalMet ? "GOAL_MET" : "NONE")}`,
        decision.thought,
        {
          step: currentStep,
          goalMet: decision.goalMet,
          action: decision.action,
          targeting: decision.targeting,
        },
      );

      transcript.push({
        step: currentStep,
        thought: decision.thought,
        action: decision.action?.type,
        result: decision.goalMet ? "Goal met" : "Action proposed",
        timestamp: new Date().toISOString(),
      });

      if (decision.goalMet) {
        this.logger?.info(
          "discovery",
          "GOAL_MET",
          "Discovery goal declared met by planner",
          decision.thought,
          { step: currentStep, goal: options.goal },
        );
        // Synthesize canonical artifact via decoupled compiler
        const artifact = compileDiscoveryEvidence({
          appId: options.appId,
          entryUrl: options.entryUrl,
          allowedDomains: options.allowedDomains,
          goal: options.goal,
          transcript,
          recordedSteps,
          declaredInputs: options.declaredInputs,
          observedOutputs: options.observedOutputs,
        });

        // Write final evidence: transcript and synthesized artifact
        if (options.evidenceDir) {
          this.flushEvidence(options.evidenceDir, transcript, artifact);
        }

        return {
          success: true,
          artifact,
          stepsTaken: currentStep,
          transcript,
          evidenceDir: options.evidenceDir,
        };
      }

      if (!decision.action) {
        if (this.coordinator) {
          await this.coordinator.requestEscalation({
            reason: "DEAD_END_DETECTED",
            message:
              "Discovery stopped: dead-end reached (LLM provided no action and goal was not declared met)",
            goal: options.goal,
            stepIndex: currentStep,
            suggestedAction: "Please provide guidance or manually advance the session",
          });
        }
        this.flushEvidence(options.evidenceDir, transcript);
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          evidenceDir: options.evidenceDir,
          error:
            "Discovery stopped: dead-end reached (LLM provided no action and goal was not declared met)",
        };
      }

      // Check Dead-end / Repetitive Action Loop Stopping Condition
      const currentActionFingerprint = JSON.stringify({
        action: decision.action,
        targeting: decision.targeting,
      });

      if (currentActionFingerprint === lastActionFingerprint) {
        consecutiveIdenticalCount++;
        if (consecutiveIdenticalCount >= maxConsecutiveIdentical) {
          if (this.coordinator) {
            await this.coordinator.requestEscalation({
              reason: "DEAD_END_DETECTED",
              message: `Discovery stopped: repetitive action dead-end detected (${maxConsecutiveIdentical} consecutive identical actions without state change)`,
              goal: options.goal,
              stepIndex: currentStep,
              suggestedAction:
                "Please navigate past the dead-end or resolve the repetitive condition",
            });
          }
          this.flushEvidence(options.evidenceDir, transcript);
          return {
            success: false,
            stepsTaken: currentStep,
            transcript,
            evidenceDir: options.evidenceDir,
            error: `Discovery stopped: repetitive action dead-end detected (${maxConsecutiveIdentical} consecutive identical actions without state change)`,
          };
        }
      } else {
        consecutiveIdenticalCount = 1;
        lastActionFingerprint = currentActionFingerprint;
      }

      // 3. Guardrail check
      const guardrailCheck = this.guardrail.checkAction(
        decision.action,
        snapshot.url,
        decision.targeting,
      );
      if (!guardrailCheck.allowed) {
        if (this.coordinator) {
          await this.coordinator.requestEscalation({
            reason: "GUARDRAIL_BLOCKED",
            message: `Guardrail blocked action: ${guardrailCheck.reason}`,
            goal: options.goal,
            stepIndex: currentStep,
            suggestedAction: "Operator review required for guardrail violation",
          });
        }
        this.flushEvidence(options.evidenceDir, transcript);
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          evidenceDir: options.evidenceDir,
          error: `Guardrail blocked action: ${guardrailCheck.reason}`,
        };
      }

      // 4. Act
      const actResult = await this.surface.act(decision.action, decision.targeting);
      this.logger?.info(
        "discovery",
        "ACT",
        `Executed ${decision.action.type} action on surface`,
        actResult.success ? "Action succeeded" : actResult.error,
        { step: currentStep, success: actResult.success, durationMs: actResult.durationMs },
      );
      if (!actResult.success) {
        this.flushEvidence(options.evidenceDir, transcript);
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          evidenceDir: options.evidenceDir,
          error: `Surface act failed: ${actResult.error}`,
        };
      }

      // Record trace step
      recordedSteps.push({
        step: currentStep,
        thought: decision.thought,
        action: decision.action,
        targeting: decision.targeting,
        success: actResult.success,
      });

      context.history.push({
        stepNumber: currentStep,
        thought: decision.thought,
        actionType: decision.action.type,
        resultSummary: actResult.success ? "Success" : actResult.error || "Failed",
      });

      currentStep++;
    }

    this.flushEvidence(options.evidenceDir, transcript);
    return {
      success: false,
      stepsTaken: currentStep - 1,
      transcript,
      evidenceDir: options.evidenceDir,
      error: `Discovery exceeded max steps limit (${maxSteps}) without achieving goal`,
    };
  }

  private flushEvidence(
    evidenceDir?: string,
    transcript?: DiscoveryRunResult["transcript"],
    artifact?: ArtifactSpec,
  ): void {
    if (!evidenceDir) return;
    if (transcript) {
      const sanitizedTranscript = Redactor.redactDeep(transcript);
      writeFileSync(
        join(evidenceDir, "transcript.json"),
        JSON.stringify(sanitizedTranscript, null, 2),
      );
    }
    if (artifact) {
      const sanitizedArtifact = Redactor.redactDeep(artifact);
      writeFileSync(
        join(evidenceDir, "synthesized-artifact.json"),
        JSON.stringify(sanitizedArtifact, null, 2),
      );
    }
    if (this.logger) {
      this.logger.writeToFile(join(evidenceDir, "structured.log.jsonl"));
    }
  }
}
