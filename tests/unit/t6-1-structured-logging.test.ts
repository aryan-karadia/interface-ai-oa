import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactSpec } from "../../src/artifact/artifact.schema";
import { DiscoveryAgent } from "../../src/discovery/agent";
import type { AgentDecision, LLMClient } from "../../src/discovery/llm-client.interface";
import { MockOperatorSurface } from "../../src/escalation/mock-operator";
import { SessionCoordinator } from "../../src/escalation/session-coordinator";
import { GuardrailService } from "../../src/guardrail/guardrail.service";
import { StructuredLogger } from "../../src/logging/structured-logger";
import { ReplayExecutor } from "../../src/replay/replay-executor";
import { MockSurface } from "../../src/surface/mock-surface";

describe("T6.1: Structured Logging Engine Across Discovery, Replay, and Escalation", () => {
  describe("StructuredLogger Core Unit Tests", () => {
    test("logs structured entries with timestamp, subsystem, action, reason, and context", () => {
      const logger = new StructuredLogger();

      logger.info(
        "discovery",
        "DECIDE",
        "LLM proposed fill action on member input",
        "I need to search for member 10042 to inspect balance",
        { step: 1, goal: "Lookup member" },
      );

      logger.warn(
        "guardrail",
        "ACTION_FLAGGED",
        "Action flagged for conservative confirmation",
        "Action matches HIGH_IRREVERSIBLE destructive pattern",
        { targetId: "ctl00_btnDelete" },
      );

      logger.error(
        "replay",
        "TARGETING_EXHAUSTED",
        "All 4 targeting tiers failed to resolve target",
        "Element occluded by maintenance modal",
        { stepId: "step_2", retries: 2 },
      );

      const allLogs = logger.getAll();
      expect(allLogs).toHaveLength(3);

      expect(allLogs[0].subsystem).toBe("discovery");
      expect(allLogs[0].action).toBe("DECIDE");
      expect(allLogs[0].reason).toContain("I need to search for member 10042");
      expect(allLogs[0].timestamp).toBeDefined();

      expect(allLogs[1].subsystem).toBe("guardrail");
      expect(allLogs[1].level).toBe("WARN");

      expect(allLogs[2].subsystem).toBe("replay");
      expect(allLogs[2].level).toBe("ERROR");
    });

    test("redacts PII and secrets automatically at the point of logging", () => {
      const logger = new StructuredLogger();

      logger.info(
        "replay",
        "STEP_EXECUTE",
        "Entering sensitive data SSN: 123-45-6789 and Bearer secret-token-xyz123",
        "Tax identification requirement for SSN 987-65-4321",
        { ssn: "123-45-6789", apiKey: "sk-ant-api03-abcdef123456789012345678901234567890" },
      );

      const logs = logger.getAll();
      expect(logs).toHaveLength(1);

      const entry = logs[0];
      expect(entry.message).not.toContain("123-45-6789");
      expect(entry.message).toContain("[REDACTED_SSN]");
      expect(entry.reason).not.toContain("987-65-4321");
      expect(entry.reason).toContain("[REDACTED_SSN]");

      const contextStr = JSON.stringify(entry.context);
      expect(contextStr).not.toContain("123-45-6789");
      expect(contextStr).toContain("[REDACTED_SSN]");
      expect(contextStr).toContain("[REDACTED_SECRET]");
    });

    test("supports querying and filtering by subsystem, level, action, and context", () => {
      const logger = new StructuredLogger();

      logger.info("discovery", "OBSERVE", "Captured DOM snapshot", "Step 1 observe", {
        runId: "run_A",
      });
      logger.info("discovery", "DECIDE", "Proposed click", "Step 1 decide", { runId: "run_A" });
      logger.info("replay", "STEP_EXECUTE", "Navigated to search", "Replay step 1", {
        runId: "run_B",
      });
      logger.warn("escalation", "ESCALATION_REQUESTED", "Targeting exhausted", "Modal occluded", {
        runId: "run_B",
      });

      const discoveryLogs = logger.query({ subsystem: "discovery" });
      expect(discoveryLogs).toHaveLength(2);

      const escalationLogs = logger.query({ subsystem: "escalation" });
      expect(escalationLogs).toHaveLength(1);
      expect(escalationLogs[0].action).toBe("ESCALATION_REQUESTED");

      const warnLogs = logger.query({ level: "WARN" });
      expect(warnLogs).toHaveLength(1);

      const runBLogs = logger.query({ runId: "run_B" });
      expect(runBLogs).toHaveLength(2);
    });

    test("exports queryable JSONL to disk and deserializes correctly", () => {
      const tmpLogPath = join(process.cwd(), "evidence", "test-structured.log.jsonl");
      if (existsSync(tmpLogPath)) rmSync(tmpLogPath);

      const logger = new StructuredLogger();
      logger.info("discovery", "INIT", "Initialized discovery session", "Starting run");
      logger.info("replay", "SUCCESS", "Replay completed", "Matched success condition");

      logger.writeToFile(tmpLogPath);
      expect(existsSync(tmpLogPath)).toBe(true);

      const fileContent = readFileSync(tmpLogPath, "utf-8").trim().split("\n");
      expect(fileContent).toHaveLength(2);

      const parsed1 = JSON.parse(fileContent[0]);
      expect(parsed1.subsystem).toBe("discovery");
      expect(parsed1.action).toBe("INIT");

      const loadedEntries = StructuredLogger.loadFromJsonl(tmpLogPath);
      expect(loadedEntries).toHaveLength(2);
      expect(loadedEntries[1].subsystem).toBe("replay");

      rmSync(tmpLogPath);
    });
  });

  describe("Subsystem Integration", () => {
    test("DiscoveryAgent records structured logs for observe, decide (with thoughts), and act", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      surface.setElement("btnSearch", { id: "btnSearch", visible: true });

      const mockLLM: LLMClient = {
        generateDecision: async (): Promise<AgentDecision> => ({
          thought: "Clicking search button to query member database",
          action: { type: "click" },
          targeting: { structural: { css: "#btnSearch" } },
          goalMet: true,
        }),
      };

      const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
      const logger = new StructuredLogger();
      const agent = new DiscoveryAgent(surface, mockLLM, guardrail, undefined, logger);

      await agent.discover({
        appId: "test-app",
        entryUrl: "http://localhost:3000/portal/search",
        allowedDomains: ["localhost"],
        goal: "Search member 10042",
        maxSteps: 3,
      });

      const discoveryLogs = logger.query({ subsystem: "discovery" });
      expect(discoveryLogs.length).toBeGreaterThanOrEqual(3);

      const decideLog = discoveryLogs.find((l) => l.action === "DECIDE");
      expect(decideLog).toBeDefined();
      expect(decideLog?.reason).toBe("Clicking search button to query member database");

      const goalLog = discoveryLogs.find((l) => l.action === "GOAL_MET");
      expect(goalLog).toBeDefined();
    });

    test("ReplayExecutor records structured logs for step execution, targeting tier, and checkpoint evaluation", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";
      surface.setElement("txtMemberId", { id: "txtMemberId", visible: true });

      const guardrail = new GuardrailService({ allowedDomains: ["localhost"] });
      const logger = new StructuredLogger();
      const executor = new ReplayExecutor(surface, guardrail, undefined, logger);

      const artifact: ArtifactSpec = {
        schemaVersion: "1.0.0",
        id: "test.replay.logging",
        name: "Test Replay Logging",
        description: "Verify replay logs",
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
        target: {
          appId: "test-app",
          entryUrl: "http://localhost:3000/portal/search",
          allowedDomains: ["localhost"],
        },
        steps: [
          {
            id: "step_fill",
            description: "Fill member id",
            action: { type: "fill", valueTemplate: "10042" },
            targeting: { structural: { css: "#txtMemberId" } },
          },
        ],
        checkpoint: {
          successCondition: {
            assertion: {
              type: "url_matches",
              expectedValue: "http://localhost:3000/portal/search",
            },
          },
        },
      };

      const result = await executor.execute(artifact);
      expect(result.status).toBe("SUCCESS");

      const replayLogs = logger.query({ subsystem: "replay" });
      expect(replayLogs.length).toBeGreaterThanOrEqual(3);

      const stepLog = replayLogs.find((l) => l.action === "STEP_SUCCESS");
      expect(stepLog).toBeDefined();
      expect(stepLog?.context?.stepId).toBe("step_fill");
      expect(stepLog?.context?.targetingTier).toBe("structural");

      const checkpointLog = replayLogs.find((l) => l.action === "CHECKPOINT_EVALUATED");
      expect(checkpointLog).toBeDefined();
      expect(checkpointLog?.reason).toContain("successCondition");
    });

    test("SessionCoordinator records structured logs for escalation triggers and ownership transitions", async () => {
      const surface = new MockSurface();
      surface.url = "http://localhost:3000/portal/search";

      const logger = new StructuredLogger();
      const coordinator = new SessionCoordinator(surface, logger);

      const operator = new MockOperatorSurface(surface, async () => {
        return "Dismissed overlay";
      });
      coordinator.setListener(operator);

      await coordinator.requestEscalation({
        reason: "TARGETING_EXHAUSTED",
        message: "Failed locating target element",
        goal: "Lookup Member",
        stepId: "step_search",
        stepIndex: 2,
      });

      const escalationLogs = logger.query({ subsystem: "escalation" });
      expect(escalationLogs.length).toBeGreaterThanOrEqual(2);

      const triggerLog = escalationLogs.find((l) => l.action === "ESCALATION_REQUESTED");
      expect(triggerLog).toBeDefined();
      expect(triggerLog?.reason).toBe("TARGETING_EXHAUSTED");
      expect(triggerLog?.context?.goal).toBe("Lookup Member");

      const takeoverLog = escalationLogs.find(
        (l) => l.action === "CONTROL_TRANSFERRED" && l.context?.toState === "HUMAN_OWNED",
      );
      expect(takeoverLog).toBeDefined();
      expect(takeoverLog?.context?.toState).toBe("HUMAN_OWNED");
    });
  });
});
