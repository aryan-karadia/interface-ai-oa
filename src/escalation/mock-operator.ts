import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StepAction, TargetingStrategy } from "../artifact/artifact.schema";
import { Redactor } from "../guardrail/redactor";
import type { ActionResult, Surface } from "../surface/surface.interface";
import type {
  EscalationListener,
  TakeoverRequest,
  TakeoverResolution,
} from "./escalation.interface";
import type { SessionCoordinator } from "./session-coordinator";

export interface OperatorActionRecord {
  action: StepAction;
  targeting?: TargetingStrategy;
  result: ActionResult;
  timestamp: string;
}

export type MockOperatorActionHandler = (
  request: TakeoverRequest,
  operator: MockOperatorSurface,
) => Promise<string | void> | string | void;

export class MockOperatorSurface implements EscalationListener {
  private activeRequest: TakeoverRequest | null = null;
  private actionsPerformed: OperatorActionRecord[] = [];
  private lastResolution: TakeoverResolution | null = null;

  constructor(
    private surface: Surface,
    private actionHandler?: MockOperatorActionHandler,
  ) {}

  getActiveRequest(): TakeoverRequest | null {
    return this.activeRequest;
  }

  getActionsPerformed(): OperatorActionRecord[] {
    return [...this.actionsPerformed];
  }

  getLastResolution(): TakeoverResolution | null {
    return this.lastResolution;
  }

  /**
   * Human operator executes an action on the live surface during takeover
   */
  async performAction(action: StepAction, targeting?: TargetingStrategy): Promise<ActionResult> {
    const result = await this.surface.act(action, targeting);
    this.actionsPerformed.push({
      action,
      targeting,
      result,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  async onRequest(request: TakeoverRequest): Promise<TakeoverResolution> {
    this.activeRequest = request;

    let notes = "Resolved by operator";
    if (this.actionHandler) {
      const handlerNotes = await this.actionHandler(request, this);
      if (typeof handlerNotes === "string") {
        notes = handlerNotes;
      }
    }

    const resolution: TakeoverResolution = {
      requestId: request.id,
      resolvedBy: "operator",
      notes,
      resumedAt: new Date().toISOString(),
    };

    this.lastResolution = resolution;
    return resolution;
  }

  /**
   * Serializes complete handoff evidence to target directory (e.g. /evidence/handoff)
   */
  async captureEvidence(
    outputDir: string,
    coordinator: SessionCoordinator,
  ): Promise<{
    requestPath: string;
    resolutionPath: string;
    timelinePath: string;
    snapshotPath?: string;
  }> {
    mkdirSync(outputDir, { recursive: true });

    // 1. intervention-request.json
    const requestPath = join(outputDir, "intervention-request.json");
    if (this.activeRequest) {
      const sanitizedRequest = Redactor.redactDeep(this.activeRequest);
      writeFileSync(requestPath, JSON.stringify(sanitizedRequest, null, 2), "utf-8");
    }

    // 2. intervention-resolution.json (with operator actions)
    const resolutionPath = join(outputDir, "intervention-resolution.json");
    const resolutionPayload = {
      resolution: this.lastResolution,
      operatorActions: this.actionsPerformed,
    };
    const sanitizedResolution = Redactor.redactDeep(resolutionPayload);
    writeFileSync(resolutionPath, JSON.stringify(sanitizedResolution, null, 2), "utf-8");

    // 3. handoff-timeline.json
    const timelinePath = join(outputDir, "handoff-timeline.json");
    const timeline = coordinator.getOwnershipTimeline();
    writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), "utf-8");

    // 4. dom-snapshot-post-handoff.json
    const snapshotPath = join(outputDir, "dom-snapshot-post-handoff.json");
    const snapshot = await this.surface.perceive().catch(() => null);
    if (snapshot) {
      const { screenshotBase64, ...domData } = snapshot;
      const sanitizedDom = Redactor.redactDeep(domData);
      writeFileSync(snapshotPath, JSON.stringify(sanitizedDom, null, 2), "utf-8");

      if (screenshotBase64) {
        const screenshotPath = join(outputDir, "screenshot-post-handoff.jpeg");
        writeFileSync(screenshotPath, Buffer.from(screenshotBase64, "base64"));
      }
    }

    return {
      requestPath,
      resolutionPath,
      timelinePath,
      snapshotPath,
    };
  }
}
