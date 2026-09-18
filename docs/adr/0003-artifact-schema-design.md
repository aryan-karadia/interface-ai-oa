# ADR 0003: Artifact Schema Design

## Status
Proposed

## Context
The automation system must synthesize a successful discovery run into a reusable, typed, versioned, serializable **Artifact**.
This artifact is the core intermediate representation (IR) of the entire system. It must be executed repeatedly by the Replay engine without an LLM, against dynamic inputs, on legacy UIs where CSS classes and element IDs are unstable or missing.

We must define an Artifact schema that is:
1. **Deterministic & Declarative:** Clear ordered steps with parameter interpolations.
2. **Resilient against Low-Affordance UIs:** Multi-tiered locator strategies with explicit priority order and fallbacks.
3. **Strongly Parameterized and Output-Typed:** Explicit input schemas with secret masks, and typed output extraction rules.
4. **Verifiable via Checkpoints:** Clear success conditions and business outcome discriminators.
5. **Versioned:** Evolution-safe schema versioning (`schemaVersion: "1.0.0"`).

## Decision

We define the Artifact specification as a TypeScript interface with accompanying `zod` validation schema:

```typescript
export interface ArtifactSpec {
  schemaVersion: "1.0.0";
  id: string;                          // Unique capability ID (e.g. "acme.portal.lookup_member")
  name: string;                        // Human-readable title
  description: string;                 // Goal fulfilled by this capability
  createdAt: string;                   // ISO 8601
  updatedAt: string;

  // App & Environment Context
  target: {
    appId: string;                     // e.g. "legacy-core-portal"
    entryUrl: string;                  // Initial route
    allowedDomains: string[];          // Origin guardrail
  };

  // Typed Input Contract
  inputs: {
    [paramName: string]: ParameterDefinition;
  };

  // Typed Output Contract
  outputs: {
    [outputName: string]: OutputDefinition;
  };

  // Ordered Execution Steps
  steps: ExecutionStep[];

  // Success Checkpoint & Expected Business Outcomes
  checkpoint: CheckpointSpec;
}

export interface ParameterDefinition {
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  default?: string | number | boolean;
  sensitive?: boolean;                 // If true, redacted in logs and traces
  validationRegex?: string;
}

export interface OutputDefinition {
  type: "string" | "number" | "boolean" | "object";
  description: string;
  sourceStepId: string;                // Step from which value is extracted
  selector: TargetingStrategy;         // How to grab the element text/attribute
  attribute?: string;                  // e.g. "innerText", "value", or custom attribute
}

export interface ExecutionStep {
  id: string;                          // e.g. "step_fill_member_id"
  description: string;
  action: StepAction;
  targeting?: TargetingStrategy;        // Required for interaction actions
  recovery?: StepRecoveryPolicy;       // Transient retry / dismiss modal
  assertions?: StepAssertion[];        // Pre/post visual or DOM checks
}

export type StepAction =
  | { type: "navigate"; url: string }
  | { type: "click"; button?: "left" | "right" | "middle" }
  | { type: "fill"; valueTemplate: string } // Supports expressions like "{{inputs.memberId}}"
  | { type: "press"; key: string }
  | { type: "select"; value: string }
  | { type: "hover" }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; timeoutMs: number }
  | { type: "extract"; outputKey: string; attribute?: string };

/**
 * Multi-Tier Targeting Strategy with Ordered Fallbacks
 * Designed specifically for legacy UIs with dynamic or missing IDs.
 */
export interface TargetingStrategy {
  // Tier 1: Accessibility / Semantic (Highest priority)
  semantic?: {
    role?: string;                     // e.g. "button", "textbox", "row"
    name?: string;                     // Accessible name / label
    exact?: boolean;
  };

  // Tier 2: Text & Anchor Proximity (For label-adjacent form fields)
  anchor?: {
    anchorText: string;                // e.g. "Member ID:"
    direction: "right" | "below" | "parent_container";
    targetTag?: string;                // e.g. "input"
  };

  // Tier 3: Structural / Relative Selector
  structural?: {
    xpath?: string;                    // Normalized relative XPath
    css?: string;                      // Stable CSS path excluding dynamic hashes
  };

  // Tier 4: Visual / Bounding Box Fallback
  visualFallback?: {
    normalizedBounds: { x: number; y: number; width: number; height: number }; // 0.0 - 1.0
    referenceImageHash?: string;       // Perceptual hash for visual sanity
  };
}

export interface StepRecoveryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  dismissOverlaysBeforeRetry?: boolean; // e.g., close toast/modal overlay
}

export interface StepAssertion {
  type: "element_visible" | "text_contains" | "url_matches";
  targeting?: TargetingStrategy;
  expectedValue?: string;
  timeoutMs?: number;
}

export interface CheckpointSpec {
  // Primary success condition
  successCondition: {
    assertion: StepAssertion;
    timeoutMs: number;
  };
  // Expected Business Outcomes (NOT crashes)
  businessOutcomes: BusinessOutcomeDefinition[];
}

export interface BusinessOutcomeDefinition {
  code: string;                        // e.g. "MEMBER_NOT_FOUND", "ACCOUNT_DELINQUENT"
  description: string;
  detection: {
    type: "element_visible" | "text_matches" | "url_matches";
    targeting: TargetingStrategy;
    pattern?: string;
  };
}
```

### Alternatives Considered and Rejected

#### Rejected Alternative: Linear Event Log / Raw CDP Recording (e.g. Puppeteer/Playwright recorded script)
- *Structure:* A flat script recording raw browser click coordinates, generated CSS selectors, and exact event timestamps (`page.click('#ctl00_content_btnSubmit_a4b9')`).
- *Why Rejected:*
  1. **Brittle to DOM Shifts:** In legacy apps, dynamic IDs change on every server restart or session. A recorded selector breaks immediately.
  2. **No Business Semantics:** Raw event logs have no concept of input parameters, outputs, business checkpoints, or expected alternative business states.
  3. **No Fallback Hierarchy:** If a single selector fails, the entire script fails with a low-level driver timeout.
  4. **Security Hazard:** Raw recordings capture live credentials and PII directly in keystroke logs with no parameter abstraction.

## Consequences

### Positive
- **High Fault Tolerance:** If a button's CSS selector changes, Tier 1 (Semantic Role/Name) or Tier 2 (Anchor Proximity) resolves it.
- **First-Class Business States:** Checkpoint explicitly defines known business outcomes separate from technical failures.
- **Parametric Reusability:** Artifact acts like a strongly-typed function: `fn(inputs) -> outputs | business_outcome`.

### Negative / Trade-offs
- Synthesizing this schema from an LLM discovery run requires a dedicated translation/synthesis step (the Discovery Compiler).
- Multi-tier targeting adds slight locator resolution overhead (evaluating candidates sequentially).
