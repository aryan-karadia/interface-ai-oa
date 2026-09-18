# ADR 0004: Replay Result Contract and Business Outcome Separation

## Status
Proposed

## Context
In typical UI automation frameworks, any deviation from the happy path is surfaced as an uncaught exception (e.g. `TimeoutError: Element not found` after 30 seconds).

In enterprise workflows, this causes a catastrophic failure mode: **conflating a valid business domain outcome with a technical automation crash**.
For example:
- *Scenario A (Business Outcome):* The automation queries Member ID `99999`. The backend returns a valid response: "No member found with ID 99999". The page displays an alert banner. The automation expected a member details table. Under naive automation, this raises `TimeoutError waiting for selector .member-details` -> reported as an automation crash. In reality, the automation functioned perfectly; the data simply doesn't exist.
- *Scenario B (Recoverable Condition):* The submit button was temporarily covered by an animation toast, or the network had a 2-second glitch.
- *Scenario C (Hard Failure):* The domain DNS failed, the browser tab crashed, or a non-recoverable security guardrail halted execution.

We need a strongly-typed, discriminated union result contract that unambiguously separates these four cases.

## Decision

We define the `ReplayResult` contract as a discriminated union:

```typescript
export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayRecoverableResult
  | ReplayHardFailureResult;

export interface ReplaySuccessResult {
  status: "SUCCESS";
  artifactVersion: string;
  executionDurationMs: number;
  stepsExecuted: number;
  outputs: Record<string, unknown>;   // Extracted typed values matching schema
  checkpointValidation: {
    matchedAssertion: string;
    timestamp: string;
  };
  telemetry: ExecutionTelemetry;
}

export interface ReplayBusinessOutcomeResult {
  status: "BUSINESS_OUTCOME";
  artifactVersion: string;
  executionDurationMs: number;
  outcomeCode: string;               // e.g. "MEMBER_NOT_FOUND", "ACCOUNT_LOCKED"
  description: string;
  evidence: {
    matchedDetectionType: string;
    detectedText?: string;
    snapshotUri?: string;
  };
  telemetry: ExecutionTelemetry;
}

export interface ReplayRecoverableResult {
  status: "RECOVERABLE_RUNTIME_CONDITION";
  artifactVersion: string;
  failedStepId: string;
  retryAttempt: number;
  maxRetries: number;
  reason: "ELEMENT_OCCLUDED" | "TRANSIENT_TIMEOUT" | "DISMISSABLE_DIALOG" | "NETWORK_IDLE_DELAY";
  suggestedAction: "DISMISS_OVERLAY_AND_RETRY" | "EXPONENTIAL_BACKOFF" | "ESCALATE_TO_HUMAN";
  telemetry: ExecutionTelemetry;
}

export interface ReplayHardFailureResult {
  status: "HARD_FAILURE";
  artifactVersion: string;
  failedStepId?: string;
  category:
    | "GUARDRAIL_VIOLATION"           // Attempted forbidden route / action
    | "TARGETING_EXHAUSTED"           // All tiers (semantic, anchor, structural, visual) failed
    | "SESSION_TERMINATED"            // Target page crashed or closed
    | "SCHEMA_MISMATCH"               // Input validation failed before execution
    | "UNHANDLED_EXCEPTION";
  message: string;
  diagnosticSnapshotUri: string;      // Redacted DOM + screenshot for debugging
  telemetry: ExecutionTelemetry;
}

export interface ExecutionTelemetry {
  runId: string;
  startedAt: string;
  completedAt: string;
  stepMetrics: Array<{
    stepId: string;
    durationMs: number;
    targetingTierUsed?: "semantic" | "anchor" | "structural" | "visualFallback";
    retries: number;
  }>;
}
```

### Mechanism: How We Avoid Conflating Business Outcomes with Crashes

1. **Pre-Step & Post-Step Checkpoint Polling:**
   At any point where a step might branch based on backend state (e.g. after clicking "Submit Search"), the Replay Executor does NOT blindly wait for the happy-path element with a 30-second timeout.
   Instead, it polls the `Surface` against a composite discriminator:
   - Happy Path Condition (e.g. `table.results-grid` is visible).
   - Known Business Outcome Conditions (e.g. `div.alert-warning` containing "No member records found").
2. **Short Circuit on Business Match:**
   If a known business outcome is detected, the execution halts immediately with `BUSINESS_OUTCOME` and records the matched outcome code and UI evidence.
3. **Structured Recovery vs Fatal Failure:**
   Transient errors (e.g. modal overlay) trigger automated recovery handlers (e.g. dismiss overlay, retry locator). Only when all targeting tiers and recovery retries are exhausted does it surface as a `HARD_FAILURE` or raise an escalation request.

## Consequences

### Positive
- Upstream callers (APIs, orchestrators, human operators) receive semantic domain results rather than false-alarm alerts and stack traces.
- Clean observability: metrics can accurately report "Business Success: 98% (including 5% expected not-found queries)" vs "Automation System Health: 99.8%".
- Deterministic debugging: diagnostics are tailored to whether a failure is recoverable or fatal.

### Negative / Trade-offs
- Artifact authoring / compilation must register business outcome conditions during the discovery phase or via manual refinement.
