// Artifact Schema & Compiler
export * from "./artifact/artifact.schema";
export * from "./artifact/artifact.validator";
export * from "./artifact/compiler";

// Surface Abstraction
export * from "./surface/surface.interface";
export * from "./surface/mock-surface";
export * from "./surface/playwright-surface";

// Replay Engine (Zero LLM Dependency)
export * from "./replay/result-contract";
export * from "./replay/locator-engine";
export * from "./replay/replay-executor";

// Guardrails & Policy
export * from "./guardrail/guardrail.interface";
export * from "./guardrail/risk-classifier";
export * from "./guardrail/redactor";
export * from "./guardrail/guardrail.service";

// Escalation & Handoff
export * from "./escalation/escalation.interface";
export * from "./escalation/session-coordinator";
export * from "./escalation/human-prompt";

// Discovery (LLM)
export * from "./discovery/llm-client.interface";
export * from "./discovery/gemini-client";
export * from "./discovery/mock-llm-client";
export * from "./discovery/agent";
