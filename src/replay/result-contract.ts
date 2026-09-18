import { z } from "zod";

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

export const StepTelemetrySchema = z.object({
  stepId: z.string(),
  actionType: z.string(),
  durationMs: z.number().nonnegative(),
  targetingTierUsed: z
    .enum(["semantic", "anchor", "structural", "visualFallback"])
    .optional(),
  retries: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
});

export interface ExecutionTelemetry {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  stepMetrics: StepTelemetry[];
}

export const ExecutionTelemetrySchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  totalDurationMs: z.number().nonnegative(),
  stepMetrics: z.array(StepTelemetrySchema),
});

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

export const ReplaySuccessResultSchema = z.object({
  status: z.literal("SUCCESS"),
  artifactVersion: z.string(),
  artifactId: z.string(),
  executionDurationMs: z.number().nonnegative(),
  stepsExecuted: z.number().int().positive(),
  outputs: z.record(z.unknown()),
  checkpointValidation: z.object({
    matchedAssertion: z.string(),
    timestamp: z.string(),
  }),
  telemetry: ExecutionTelemetrySchema,
});

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

export const ReplayBusinessOutcomeResultSchema = z.object({
  status: z.literal("BUSINESS_OUTCOME"),
  artifactVersion: z.string(),
  artifactId: z.string(),
  executionDurationMs: z.number().nonnegative(),
  outcomeCode: z.string(),
  description: z.string(),
  evidence: z.object({
    matchedDetectionType: z.string(),
    detectedText: z.string().optional(),
    snapshotUri: z.string().optional(),
  }),
  telemetry: ExecutionTelemetrySchema,
});

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

export const ReplayRecoverableResultSchema = z.object({
  status: z.literal("RECOVERABLE_RUNTIME_CONDITION"),
  artifactVersion: z.string(),
  artifactId: z.string(),
  failedStepId: z.string(),
  retryAttempt: z.number().int().nonnegative(),
  maxRetries: z.number().int().positive(),
  reason: z.enum([
    "ELEMENT_OCCLUDED",
    "TRANSIENT_TIMEOUT",
    "DISMISSABLE_DIALOG",
    "NETWORK_IDLE_DELAY",
  ]),
  suggestedAction: z.enum([
    "DISMISS_OVERLAY_AND_RETRY",
    "EXPONENTIAL_BACKOFF",
    "ESCALATE_TO_HUMAN",
  ]),
  telemetry: ExecutionTelemetrySchema,
});

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

export const ReplayHardFailureResultSchema = z.object({
  status: z.literal("HARD_FAILURE"),
  artifactVersion: z.string(),
  artifactId: z.string(),
  failedStepId: z.string().optional(),
  category: z.enum([
    "GUARDRAIL_VIOLATION",
    "TARGETING_EXHAUSTED",
    "SESSION_TERMINATED",
    "SCHEMA_MISMATCH",
    "UNHANDLED_EXCEPTION",
  ]),
  message: z.string(),
  diagnosticSnapshotUri: z.string().optional(),
  telemetry: ExecutionTelemetrySchema,
});

/**
 * The unified Discriminated Union result contract
 */
export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayRecoverableResult
  | ReplayHardFailureResult;

export const ReplayResultSchema = z.discriminatedUnion("status", [
  ReplaySuccessResultSchema,
  ReplayBusinessOutcomeResultSchema,
  ReplayRecoverableResultSchema,
  ReplayHardFailureResultSchema,
]);

export interface ReplayValidationReport {
  valid: boolean;
  result?: ReplayResult;
  errors: Array<{ path: string; message: string }>;
}

export function validateReplayResult(data: unknown): ReplayValidationReport {
  const parseResult = ReplayResultSchema.safeParse(data);
  if (parseResult.success) {
    return { valid: true, result: parseResult.data as ReplayResult, errors: [] };
  }
  return {
    valid: false,
    errors: parseResult.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

// ---------------------------------------------------------------------------
// Concrete Examples for Documentation and Contracts
// ---------------------------------------------------------------------------

export const exampleSuccessResult: ReplaySuccessResult = {
  status: "SUCCESS",
  artifactId: "legacy.portal.lookup_member",
  artifactVersion: "1.0.0",
  executionDurationMs: 420,
  stepsExecuted: 3,
  outputs: {
    memberName: "Alice Henderson",
    accountBalance: "$240.50",
  },
  checkpointValidation: {
    matchedAssertion: "element_visible: #ctl00_gridMemberDetails",
    timestamp: "2026-09-18T12:00:01.000Z",
  },
  telemetry: {
    runId: "replay_1789768000_abcde",
    startedAt: "2026-09-18T12:00:00.000Z",
    completedAt: "2026-09-18T12:00:01.000Z",
    totalDurationMs: 420,
    stepMetrics: [
      {
        stepId: "step_1_navigate",
        actionType: "navigate",
        durationMs: 120,
        retries: 0,
        success: true,
      },
      {
        stepId: "step_2_fill_member_id",
        actionType: "fill",
        durationMs: 80,
        targetingTierUsed: "semantic",
        retries: 0,
        success: true,
      },
      {
        stepId: "step_3_click_search",
        actionType: "click",
        durationMs: 220,
        targetingTierUsed: "semantic",
        retries: 0,
        success: true,
      },
    ],
  },
};

export const exampleBusinessOutcomeResult: ReplayBusinessOutcomeResult = {
  status: "BUSINESS_OUTCOME",
  artifactId: "legacy.portal.lookup_member",
  artifactVersion: "1.0.0",
  executionDurationMs: 380,
  outcomeCode: "MEMBER_NOT_FOUND",
  description: "No member found matching identifier 99999",
  evidence: {
    matchedDetectionType: "text_matches",
    detectedText: "No active member records found for ID: 99999",
  },
  telemetry: {
    runId: "replay_1789768001_fghij",
    startedAt: "2026-09-18T12:05:00.000Z",
    completedAt: "2026-09-18T12:05:01.000Z",
    totalDurationMs: 380,
    stepMetrics: [
      {
        stepId: "step_1_navigate",
        actionType: "navigate",
        durationMs: 100,
        retries: 0,
        success: true,
      },
      {
        stepId: "step_2_fill_member_id",
        actionType: "fill",
        durationMs: 70,
        targetingTierUsed: "semantic",
        retries: 0,
        success: true,
      },
      {
        stepId: "step_3_click_search",
        actionType: "click",
        durationMs: 210,
        targetingTierUsed: "semantic",
        retries: 0,
        success: true,
      },
    ],
  },
};

export const exampleRecoverableResult: ReplayRecoverableResult = {
  status: "RECOVERABLE_RUNTIME_CONDITION",
  artifactId: "legacy.portal.lookup_member",
  artifactVersion: "1.0.0",
  failedStepId: "step_3_click_search",
  retryAttempt: 1,
  maxRetries: 2,
  reason: "ELEMENT_OCCLUDED",
  suggestedAction: "DISMISS_OVERLAY_AND_RETRY",
  telemetry: {
    runId: "replay_1789768002_klmno",
    startedAt: "2026-09-18T12:10:00.000Z",
    completedAt: "2026-09-18T12:10:01.000Z",
    totalDurationMs: 250,
    stepMetrics: [
      {
        stepId: "step_3_click_search",
        actionType: "click",
        durationMs: 250,
        retries: 1,
        success: false,
        error: "Element intercepted by modal overlay #modalPromo",
      },
    ],
  },
};

export const exampleHardFailureResult: ReplayHardFailureResult = {
  status: "HARD_FAILURE",
  artifactId: "legacy.portal.lookup_member",
  artifactVersion: "1.0.0",
  failedStepId: "step_1_navigate",
  category: "GUARDRAIL_VIOLATION",
  message: "Navigation to external domain https://phishing-site.example.com blocked by security policy",
  diagnosticSnapshotUri: "evidence/runs/run_failure_01/dom-snapshot.json",
  telemetry: {
    runId: "replay_1789768003_pqrst",
    startedAt: "2026-09-18T12:15:00.000Z",
    completedAt: "2026-09-18T12:15:00.050Z",
    totalDurationMs: 50,
    stepMetrics: [
      {
        stepId: "step_1_navigate",
        actionType: "navigate",
        durationMs: 50,
        retries: 0,
        success: false,
        error: "Domain 'phishing-site.example.com' not in whitelist [localhost, 127.0.0.1]",
      },
    ],
  },
};
