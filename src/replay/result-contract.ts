/**
 * Execution telemetry details for observability and auditing
 */
export interface StepTelemetry {
  stepId: string;
  actionType: string;
  durationMs: number;
  targetingTierUsed?: "semantic" | "anchor" | "structural" | "visualFallback";
  retries: number;
  success: boolean;
  error?: string;
}

export interface ExecutionTelemetry {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  stepMetrics: StepTelemetry[];
}

/**
 * Successful execution: all steps passed and checkpoint asserted
 */
export interface ReplaySuccessResult {
  status: "SUCCESS";
  artifactVersion: string;
  artifactId: string;
  executionDurationMs: number;
  stepsExecuted: number;
  outputs: Record<string, unknown>;
  checkpointValidation: {
    matchedAssertion: string;
    timestamp: string;
  };
  telemetry: ExecutionTelemetry;
}

/**
 * Expected business domain outcome (NOT an automation crash)
 * e.g. "MEMBER_NOT_FOUND", "ACCOUNT_DELINQUENT"
 */
export interface ReplayBusinessOutcomeResult {
  status: "BUSINESS_OUTCOME";
  artifactVersion: string;
  artifactId: string;
  executionDurationMs: number;
  outcomeCode: string;
  description: string;
  evidence: {
    matchedDetectionType: string;
    detectedText?: string;
    snapshotUri?: string;
  };
  telemetry: ExecutionTelemetry;
}

/**
 * Transient, recoverable runtime condition
 * e.g. element occluded by modal, network idle glitch
 */
export interface ReplayRecoverableResult {
  status: "RECOVERABLE_RUNTIME_CONDITION";
  artifactVersion: string;
  artifactId: string;
  failedStepId: string;
  retryAttempt: number;
  maxRetries: number;
  reason: "ELEMENT_OCCLUDED" | "TRANSIENT_TIMEOUT" | "DISMISSABLE_DIALOG" | "NETWORK_IDLE_DELAY";
  suggestedAction: "DISMISS_OVERLAY_AND_RETRY" | "EXPONENTIAL_BACKOFF" | "ESCALATE_TO_HUMAN";
  telemetry: ExecutionTelemetry;
}

/**
 * Irrecoverable technical crash or security violation
 */
export interface ReplayHardFailureResult {
  status: "HARD_FAILURE";
  artifactVersion: string;
  artifactId: string;
  failedStepId?: string;
  category:
    | "GUARDRAIL_VIOLATION"
    | "TARGETING_EXHAUSTED"
    | "SESSION_TERMINATED"
    | "SCHEMA_MISMATCH"
    | "UNHANDLED_EXCEPTION";
  message: string;
  diagnosticSnapshotUri?: string;
  telemetry: ExecutionTelemetry;
}

/**
 * The unified Discriminated Union result contract
 */
export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayRecoverableResult
  | ReplayHardFailureResult;
