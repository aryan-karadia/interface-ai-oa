import type { LLMClient, AgentDecision, DiscoveryContext } from "./llm-client.interface";
import type { SurfaceSnapshot } from "../surface/surface.interface";

export class MockLLMClient implements LLMClient {
  private cannedDecisions: AgentDecision[] = [];
  private callIndex = 0;

  constructor(decisions: AgentDecision[] = []) {
    this.cannedDecisions = decisions;
  }

  setDecisions(decisions: AgentDecision[]): void {
    this.cannedDecisions = decisions;
    this.callIndex = 0;
  }

  async generateDecision(
    _snapshot: SurfaceSnapshot,
    _context: DiscoveryContext
  ): Promise<AgentDecision> {
    if (this.callIndex < this.cannedDecisions.length) {
      const decision = this.cannedDecisions[this.callIndex++];
      return decision;
    }

    return {
      thought: "No further programmed actions. Terminating discovery.",
      goalMet: true,
    };
  }
}
