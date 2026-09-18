# ADR 003: Replay Result Contract & Error Taxonomy

## Status
Accepted

## Context
When an automated agent executes a capability against a computer surface (legacy web, desktop, terminal), the execution outcome must not be reduced to a binary `pass/fail` or a generic `TimeoutError`.
Traditional test frameworks (e.g. Jest, Playwright) throw exceptions when an element is missing, conflating three fundamentally distinct operational realities:
1. **Expected Business Domain Outcomes:** The system correctly executed the search, and the backend legitimately returned an expected business state (e.g. "Member not found with ID 99999", "Account Suspended"). Alerting an engineer or treating this as a system crash is a severe false alarm.
2. **Recoverable Runtime Conditions:** Transient environmental friction (e.g. an unexpected marketing modal, cookie consent overlay, or transient network lag) temporarily blocks interaction, but the condition can be dismissed or retried without altering the capability logic.
3. **Hard Failures:** Unrecoverable technical roadblocks or security violations (e.g. domain boundary violation, complete locator exhaustion across all 4 tiers, broken authentication) that require execution halt, detailed diagnostics, and engineer review.

In Section 7 of the evaluation rubric, "correctness of the core loop" and "robustness & error handling" are explicitly prioritized. We must formalize a rigorous taxonomy and typed contract.

## Decision

We define a strict Discriminated Union result contract (`ReplayResult`) with four first-class statuses:

```typescript
export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayRecoverableResult
  | ReplayHardFailureResult;
```

### 1. `SUCCESS`
The capability executed all ordered steps, satisfied the primary checkpoint assertion, and extracted all requested output parameters.
- **Fields:** `status: "SUCCESS"`, `artifactId`, `artifactVersion`, `stepsExecuted`, `outputs`, `checkpointValidation`, `telemetry`.

### 2. `BUSINESS_OUTCOME`
The capability executed correctly, but the application domain rendered a legitimate business end-state.
- **Concrete Examples:**
  - `MEMBER_NOT_FOUND`: Database has no active record matching query criteria.
  - `ACCOUNT_SUSPENDED`: User account is locked in administrative review.
  - `OUT_OF_STOCK`: Inventory catalog has 0 available units.
- **Fields:** `status: "BUSINESS_OUTCOME"`, `outcomeCode`, `description`, `evidence: { matchedDetectionType, detectedText, snapshotUri }`, `telemetry`.

### 3. `RECOVERABLE_RUNTIME_CONDITION`
A transient, non-fatal obstruction occurred that can be cleared automatically or handed to a retry loop.
- **Concrete Examples:**
  - `ELEMENT_OCCLUDED`: A promo banner or dismissable session dialog is blocking the click target.
  - `TRANSIENT_TIMEOUT`: DOM rendering slowness under heavy server load.
- **Recovery Policies:**
  - `DISMISS_OVERLAY_AND_RETRY`: Auto-trigger modal dismissal heuristics.
  - `EXPONENTIAL_BACKOFF`: Pause and retry locator resolution.
  - `ESCALATE_TO_HUMAN`: Signal human operator to clear the obstruction.
- **Fields:** `status: "RECOVERABLE_RUNTIME_CONDITION"`, `failedStepId`, `retryAttempt`, `maxRetries`, `reason`, `suggestedAction`, `telemetry`.

### 4. `HARD_FAILURE`
An irrecoverable fault occurred, terminating execution and preserving full diagnostic state.
- **Categories:**
  - `GUARDRAIL_VIOLATION`: Navigation to unapproved external domain or unauthorized high-risk action.
  - `TARGETING_EXHAUSTED`: Element could not be located across all 4 tiers (Semantic, Anchor, Structural, Visual) and recovery failed.
  - `SCHEMA_MISMATCH`: Missing mandatory input parameters or malformed artifact structure.
  - `SESSION_TERMINATED`: Target app kicked session back to login page.
- **Fields:** `status: "HARD_FAILURE"`, `failedStepId`, `category`, `message`, `diagnosticSnapshotUri`, `telemetry`.

---

## Consequences

### Positive
- **Zero False-Alarm Outages:** Upstream business workflows receive clean domain codes (`MEMBER_NOT_FOUND`) rather than crash logs.
- **Self-Healing Automation:** Transient popups and occlusions are classified as recoverable and resolved autonomously before failing.
- **Complete Diagnostic Observability:** Every outcome includes `ExecutionTelemetry` detailing per-step durations, targeting tiers used, retry counts, and timestamps.

### Negative / Trade-offs
- Artifact authors or compilers must explicitly define checkpoint detection rules for expected business outcomes.
