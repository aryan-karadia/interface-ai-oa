# ADR-004: Risky vs. Reversible Action Policy and Conservative Handling

## Status
Accepted

## Context
Our Computer-Use Automation System operates within enterprise and regulated financial domains (e.g. banking portals, insurance claims engines, and healthcare benefit administration systems). In these environments, web interfaces possess buttons, inputs, and triggers that carry drastically divergent consequences:
1. **Idempotent / Read-Only Operations:** Searching for a record, expanding a navigation tree, reading account balances, or hovering over an audit badge.
2. **Reversible Mutations:** Typing a filter query into a textbox, selecting a dropdown filter, or clearing an unsubmitted search form.
3. **Irreversible Destructive Mutations:** Clicking "Purge Member Record", executing a wire transfer, terminating coverage, changing account credentials, or batch-deleting claims.

When LLM discovery agents explore unfamiliar interfaces or deterministic replay engines run automated capabilities, executing an irreversible action without authorization poses extreme operational, regulatory (HIPAA, GLBA, SOC-2), and financial risks.

## Decision

We formalize a 3-tier action risk classification taxonomy and a conservative multi-mode enforcement policy implemented at both discovery and replay time.

### 1. Action Risk Taxonomy

| Risk Level | Designation | Action Types / Target Characteristics | Reversibility | Default Handling |
| :--- | :--- | :--- | :--- | :--- |
| `LOW` | **Safe / Reversible** | `navigate`, `wait`, `hover`, `scroll`, `extract`, reading text/attributes. | Fully reversible; idempotent. | Unrestricted execution. |
| `MEDIUM` | **Moderate / Stateful** | `fill`, `select`, `press`, generic non-destructive `click` (e.g. "Search", "Next", "View"). | Reversible by clearing or navigating away. | Allowed within allowlisted domains. |
| `HIGH_IRREVERSIBLE` | **Risky / Irreversible** | Actions matching destructive verbs (`delete`, `remove`, `purge`, `destroy`, `terminate`), financial triggers (`transfer`, `wire`, `pay`, `checkout`, `order`), or PII/credential modifications. | **Irreversible / Permanent** state mutation. | Conservative handling required. |

### 2. Conservative Handling Modes

The system provides three configurable modes for `HIGH_IRREVERSIBLE` actions:

1. **`BLOCK` (Autonomous Default - Fail-Closed):**
   - The engine unconditionally blocks execution of any action classified as `HIGH_IRREVERSIBLE`.
   - Generates a `HIGH_RISK_UNAUTHORIZED` violation category and logs a tamper-evident entry in the `SecurityAuditEntry` audit log.
   - Replay terminates with a typed `HARD_FAILURE`.
   - **Justification:** Guarantees zero unintended damage during unattended, headless batch runs.

2. **`CONFIRM` (Human-in-the-Loop Gating):**
   - When a high-risk action is encountered, the automation loop pauses and initiates a cryptographic or operator session escalation prompt (via `SessionCoordinator`).
   - The operator inspects the proposed action, target element, and current screenshot before granting an approval token.
   - If denied or timed out, the action is aborted and logged.
   - **Justification:** Enables high-value automation of sensitive enterprise tasks while maintaining strict compliance oversight.

3. **`FLAG` (Audited Execution):**
   - Permits execution only when explicitly configured by an authenticated admin with audit flags enabled.
   - Captures pre-action and post-action DOM snapshots and emits high-priority telemetry alerts.
   - **Justification:** Required in staging or testing sandboxes validating end-to-end deletion workflows.

### 3. Classification Mechanism (`RiskClassifier`)

Classification combines:
- **Action Primitive Introspection:** Base primitives like `navigate` or `extract` are inherently `LOW` risk.
- **Target Lexical Analysis:** Scans target element accessibility names (`semantic.name`), visible text (`anchor.anchorText`), and selector identifiers (`structural.css` / `structural.xpath`) against a curated catalog of high-impact action keywords:
  - Destructive: `delete`, `remove`, `purge`, `destroy`, `terminate`, `drop`
  - Financial: `transfer`, `wire`, `pay`, `checkout`, `order`
  - Administrative: `reset-password`, `grant-admin`, `revoke`
- **Dynamic Structural Hints:** CSS classes indicating destructive styles (e.g. `btn-danger`, `btn-danger-fake`, `destructive-action`).

## Consequences

### Positive
- **Guaranteed Zero Accidental Data Loss:** Autonomous discovery and replay cannot accidentally trigger destructive enterprise endpoints (such as the `#ctl00_btnDeleteMember` "Purge Member Record" button in our proxy fixture).
- **Regulatory Compliance:** Satisfies banking and HIPAA requirements for non-repudiation and separation of duties on irreversible transactions.
- **Auditable Safety Trail:** Every blocked or gated attempt is recorded in structured audit logs with timestamps and violation categories.

### Negative / Trade-offs
- Over-conservative keyword matching might flag false positives (e.g. clicking a button labelled "Remove Filter"). The engine supports explicit policy overrides (`allowedActionTypes`, custom allowlists) for verified non-destructive contexts.
