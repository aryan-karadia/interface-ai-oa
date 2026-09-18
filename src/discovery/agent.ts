import type { Surface } from "../surface/surface.interface";
import type { LLMClient, DiscoveryContext } from "./llm-client.interface";
import type { IGuardrailService } from "../guardrail/guardrail.interface";
import type { ArtifactSpec, ExecutionStep } from "../artifact/artifact.schema";
import { buildArtifact } from "../artifact/compiler";

export interface DiscoveryOptions {
  goal: string;
  appId: string;
  entryUrl: string;
  allowedDomains: string[];
  maxSteps?: number;
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
  }>;
  error?: string;
}

export class DiscoveryAgent {
  constructor(
    private surface: Surface,
    private llmClient: LLMClient,
    private guardrail: IGuardrailService
  ) {}

  async discover(options: DiscoveryOptions): Promise<DiscoveryRunResult> {
    const maxSteps = options.maxSteps ?? 10;
    const transcript: DiscoveryRunResult["transcript"] = [];
    const recordedSteps: ExecutionStep[] = [];
    const context: DiscoveryContext = {
      goal: options.goal,
      appId: options.appId,
      history: [],
    };

    // Initial navigation
    await this.surface.navigate(options.entryUrl);
    recordedSteps.push({
      id: "step_initial_navigation",
      description: `Navigate to initial target URL`,
      action: { type: "navigate", url: options.entryUrl },
    });

    let currentStep = 1;

    while (currentStep <= maxSteps) {
      // 1. Observe (Perceive Surface)
      const snapshot = await this.surface.perceive();

      // 2. Decide (LLM generation)
      const decision = await this.llmClient.generateDecision(snapshot, context);

      transcript.push({
        step: currentStep,
        thought: decision.thought,
        action: decision.action?.type,
        result: decision.goalMet ? "Goal met" : "Action executed",
      });

      if (decision.goalMet) {
        // Synthesize canonical artifact
        const artifact = buildArtifact({
          id: `artifact_${options.appId}_${Date.now()}`,
          name: `Automated ${options.goal}`,
          description: options.goal,
          target: {
            appId: options.appId,
            entryUrl: options.entryUrl,
            allowedDomains: options.allowedDomains,
          },
          steps: recordedSteps,
          checkpoint: {
            successCondition: {
              assertion: {
                type: "url_matches",
                expectedValue: options.entryUrl,
              },
              timeoutMs: 5000,
            },
            businessOutcomes: [],
          },
        });

        return {
          success: true,
          artifact,
          stepsTaken: currentStep,
          transcript,
        };
      }

      if (!decision.action) {
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          error: "LLM provided no action but goal was not declared met",
        };
      }

      // 3. Guardrail check
      const guardrailCheck = this.guardrail.checkAction(
        decision.action,
        snapshot.url,
        decision.targeting
      );
      if (!guardrailCheck.allowed) {
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          error: `Guardrail blocked action: ${guardrailCheck.reason}`,
        };
      }

      // 4. Act
      const actResult = await this.surface.act(decision.action, decision.targeting);
      if (!actResult.success) {
        return {
          success: false,
          stepsTaken: currentStep,
          transcript,
          error: `Surface act failed: ${actResult.error}`,
        };
      }

      // Record canonical step
      recordedSteps.push({
        id: `step_${currentStep}_${decision.action.type}`,
        description: decision.thought,
        action: decision.action,
        targeting: decision.targeting,
      });

      context.history.push({
        stepNumber: currentStep,
        thought: decision.thought,
        actionType: decision.action.type,
        resultSummary: actResult.success ? "Success" : (actResult.error || "Failed"),
      });

      currentStep++;
    }

    return {
      success: false,
      stepsTaken: currentStep - 1,
      transcript,
      error: `Discovery exceeded max steps limit (${maxSteps}) without achieving goal`,
    };
  }
}
