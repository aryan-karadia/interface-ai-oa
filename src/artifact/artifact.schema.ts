import { z } from "zod";

/**
 * Parameter definition schema
 */
export interface ParameterDefinition {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  sensitive?: boolean;
  validationRegex?: string;
}

export const ParameterDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string(),
  required: z.boolean().optional().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  sensitive: z.boolean().optional().default(false),
  validationRegex: z.string().optional(),
});

/**
 * Multi-Tier Targeting Strategy Schema
 * Designed for low-affordance enterprise UIs with volatile or missing IDs.
 */
export interface TargetingStrategy {
  semantic?: {
    role?: string;
    name?: string;
    exact?: boolean;
  };
  anchor?: {
    anchorText: string;
    direction?: "right" | "below" | "parent_container";
    targetTag?: string;
  };
  structural?: {
    xpath?: string;
    css?: string;
  };
  visualFallback?: {
    normalizedBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    referenceImageHash?: string;
  };
}

export const TargetingStrategySchema = z.object({
  semantic: z
    .object({
      role: z.string().optional(),
      name: z.string().optional(),
      exact: z.boolean().optional().default(false),
    })
    .optional(),

  anchor: z
    .object({
      anchorText: z.string(),
      direction: z.enum(["right", "below", "parent_container"]).optional().default("right"),
      targetTag: z.string().optional().default("input"),
    })
    .optional(),

  structural: z
    .object({
      xpath: z.string().optional(),
      css: z.string().optional(),
    })
    .optional(),

  visualFallback: z
    .object({
      normalizedBounds: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      }),
      referenceImageHash: z.string().optional(),
    })
    .optional(),
});

/**
 * Output extraction definition
 */
export interface OutputDefinition {
  type: "string" | "number" | "boolean" | "object";
  description: string;
  sourceStepId: string;
  selector: TargetingStrategy;
  attribute?: string;
}

export const OutputDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string(),
  sourceStepId: z.string(),
  selector: TargetingStrategySchema,
  attribute: z.string().optional().default("innerText"),
});

/**
 * Action types
 */
export type StepAction =
  | { type: "navigate"; url: string }
  | { type: "click"; button?: "left" | "right" | "middle" }
  | { type: "fill"; valueTemplate: string } // e.g. "{{inputs.memberId}}"
  | { type: "press"; key: string }
  | { type: "select"; value: string }
  | { type: "hover" }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; timeoutMs: number }
  | { type: "extract"; outputKey: string; attribute?: string };

export const StepActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string(),
  }),
  z.object({
    type: z.literal("click"),
    button: z.enum(["left", "right", "middle"]).optional().default("left"),
  }),
  z.object({
    type: z.literal("fill"),
    valueTemplate: z.string(),
  }),
  z.object({
    type: z.literal("press"),
    key: z.string(),
  }),
  z.object({
    type: z.literal("select"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("hover"),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().optional(),
  }),
  z.object({
    type: z.literal("wait"),
    timeoutMs: z.number().positive(),
  }),
  z.object({
    type: z.literal("extract"),
    outputKey: z.string(),
    attribute: z.string().optional().default("innerText"),
  }),
]);

/**
 * Transient error recovery policy
 */
export interface StepRecoveryPolicy {
  maxRetries?: number;
  retryDelayMs?: number;
  dismissOverlaysBeforeRetry?: boolean;
}

export const StepRecoveryPolicySchema = z.object({
  maxRetries: z.number().int().nonnegative().optional().default(2),
  retryDelayMs: z.number().int().nonnegative().optional().default(1000),
  dismissOverlaysBeforeRetry: z.boolean().optional().default(true),
});

/**
 * Step assertion
 */
export interface StepAssertion {
  type: "element_visible" | "text_contains" | "url_matches";
  targeting?: TargetingStrategy;
  expectedValue?: string;
  timeoutMs?: number;
}

export const StepAssertionSchema = z.object({
  type: z.enum(["element_visible", "text_contains", "url_matches"]),
  targeting: TargetingStrategySchema.optional(),
  expectedValue: z.string().optional(),
  timeoutMs: z.number().int().positive().optional().default(5000),
});

/**
 * Execution step
 */
export interface ExecutionStep {
  id: string;
  description: string;
  action: StepAction;
  targeting?: TargetingStrategy;
  recovery?: StepRecoveryPolicy;
  assertions?: StepAssertion[];
}

export const ExecutionStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: StepActionSchema,
  targeting: TargetingStrategySchema.optional(),
  recovery: StepRecoveryPolicySchema.optional(),
  assertions: z.array(StepAssertionSchema).optional(),
});

/**
 * Business outcome definition (Domain outcomes, NOT crashes)
 */
export interface BusinessOutcomeDefinition {
  code: string; // e.g. "MEMBER_NOT_FOUND", "ACCOUNT_SUSPENDED"
  description: string;
  detection: {
    type: "element_visible" | "text_matches" | "url_matches";
    targeting: TargetingStrategy;
    pattern?: string;
  };
}

export const BusinessOutcomeDefinitionSchema = z.object({
  code: z.string(),
  description: z.string(),
  detection: z.object({
    type: z.enum(["element_visible", "text_matches", "url_matches"]),
    targeting: TargetingStrategySchema,
    pattern: z.string().optional(),
  }),
});

/**
 * Checkpoint
 */
export interface CheckpointSpec {
  successCondition: {
    assertion: StepAssertion;
    timeoutMs?: number;
  };
  businessOutcomes?: BusinessOutcomeDefinition[];
}

export const CheckpointSpecSchema = z.object({
  successCondition: z.object({
    assertion: StepAssertionSchema,
    timeoutMs: z.number().int().positive().optional().default(10000),
  }),
  businessOutcomes: z.array(BusinessOutcomeDefinitionSchema).optional().default([]),
});

/**
 * Target app metadata
 */
export interface TargetAppSpec {
  appId: string;
  entryUrl: string;
  allowedDomains: string[];
}

export const TargetAppSpecSchema = z.object({
  appId: z.string(),
  entryUrl: z.string(),
  allowedDomains: z.array(z.string()),
});

/**
 * Complete Artifact Specification
 */
export interface ArtifactSpec {
  schemaVersion: "1.0.0";
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  target: TargetAppSpec;
  inputs?: Record<string, ParameterDefinition>;
  outputs?: Record<string, OutputDefinition>;
  steps: ExecutionStep[];
  checkpoint: CheckpointSpec;
}

export const ArtifactSpecSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  target: TargetAppSpecSchema,
  inputs: z.record(ParameterDefinitionSchema).optional().default({}),
  outputs: z.record(OutputDefinitionSchema).optional().default({}),
  steps: z.array(ExecutionStepSchema).min(1),
  checkpoint: CheckpointSpecSchema,
});
