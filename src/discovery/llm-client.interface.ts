import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";
import type { SurfaceSnapshot } from "../surface/surface.interface";

export interface AgentDecision {
  thought: string;
  action?: StepAction;
  targeting?: TargetingStrategy;
  goalMet: boolean;
  notes?: string;
}

export interface DiscoveryContext {
  goal: string;
  appId: string;
  history: Array<{
    stepNumber: number;
    thought: string;
    actionType?: string;
    resultSummary: string;
  }>;
}

export interface LLMClient {
  generateDecision(
    snapshot: SurfaceSnapshot,
    context: DiscoveryContext
  ): Promise<AgentDecision>;
}
