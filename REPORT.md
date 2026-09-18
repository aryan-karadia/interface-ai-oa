# Engineering Report: Computer-Use Automation System

## 1. Executive Summary & Architecture Overview
This system implements a production-grade Computer-Use Automation System capable of:
1. Exploring and interacting with low-affordance legacy enterprise web surfaces (unsemantic table layouts, dynamic server IDs, modal overlays, unsemantic clickable spans).
2. Synthesizing successful runs into versioned, typed, deterministic capability artifacts.
3. Replaying artifacts deterministically with zero model inference in the loop, cleanly segregating expected business outcomes from runtime exceptions and hard failures.
4. Escalating seamlessly to human operators when encountering unresolvable conditions.
5. Enforcing rigorous safety guardrails (domain allowlists, action risk classifications, PII scrubbing).

---

## 2. Low-Affordance Legacy Surface & Proxy Target
Legacy enterprise systems (e.g. ASP.NET WebForms, Siebel, SAP WebGUI, Oracle Forms) violate modern web accessibility principles:
- Form field IDs regenerate on server restarts and postbacks (e.g., `ctl00_MainContent_tabSearch_txtMemberId_8912`).
- Interactive triggers are frequently non-semantic `<span>` or `<div>` elements with inline `onclick` handlers, omitting keyboard and ARIA roles.
- Form inputs lack explicit `<label for="...">` associations, relying purely on adjacent text layout inside `<table>` cells.
- Asynchronous partial page renders and unexpected modal overlays (e.g., session notices or promo banners) intercept pointer events.

---

## 3. Locator & Targeting Robustness Strategy

### 3.1 The 4-Tier Priority-Ordered Targeting Chain
To withstand dynamic DOM mutations without failing replays, every interactive element targeting specification defines a 4-tier fallback chain:

1. **Tier 1: Semantic / Accessibility (`semantic`):**
   - **Mechanism:** Queries the browser accessibility tree matching `role` (e.g. `textbox`, `button`) and accessible `name` (via `aria-label`, `title`, or inner text).
   - **Rationale:** The accessibility tree abstracts away CSS classes, layout wrappers, and dynamic ID hashes. Even if an enterprise frontend undergoes restyling, semantic roles and names usually remain stable.
   - **Legacy Limitation:** Low-affordance applications often use unsemantic tags (e.g., `<span class="btn-fake">`) lacking ARIA roles.

2. **Tier 2: Anchor Text Proximity (`anchor`):**
   - **Mechanism:** Locates loose visible text labels (e.g., `"Member ID:"`) and resolves the adjacent input control in the specified spatial or DOM direction (`direction: "right"`, `targetTag: "input"`).
   - **Rationale:** In table-based enterprise forms, labels sit in `<td>Label:</td>` and inputs sit in the adjacent `<td><input /></td>`. By anchoring to the human-readable text label, the locator survives complete changes to input element IDs or names.

3. **Tier 3: Structural Relative Path (`structural`):**
   - **Mechanism:** Uses stable relative CSS or XPath selectors with dynamic ID prefix normalization (e.g., stripping random alphanumeric suffixes like `_329a` or matching stable container hierarchies).
   - **Rationale:** Provides deterministic fallback when an element has neither an accessibility role nor nearby label text (e.g., a specific cell in an unlabelled data grid).

4. **Tier 4: Visual Bounding Box (`visualFallback`):**
   - **Mechanism:** Normalized coordinates (`x, y, width, height` in the 0.0–1.0 viewport coordinate space) paired with perceptual bounding boxes.
   - **Rationale:** Final safety net for custom canvas elements, plugins, or deeply nested iframes where DOM targeting fails.

```
       +---------------------------------------------+
       | Step Execution: Locator Resolution Attempt  |
       +---------------------------------------------+
                              |
                              v
                +----------------------------+
                |  Tier 1: Semantic (ARIA)   | ----[Match Found]----> Execute Action
                +----------------------------+
                              | [Miss / No Role]
                              v
                +----------------------------+
                |  Tier 2: Anchor Proximity  | ----[Match Found]----> Execute Action
                +----------------------------+
                              | [Miss / No Label]
                              v
                +----------------------------+
                |  Tier 3: Structural Path   | ----[Match Found]----> Execute Action
                +----------------------------+
                              | [Miss / Hash Altered]
                              v
                +----------------------------+
                |  Tier 4: Visual Bounding   | ----[Match Found]----> Execute Action
                +----------------------------+
                              | [Miss]
                              v
              +-------------------------------+
              |   Recovery / Modal Dismissal  |
              +-------------------------------+
```

### 3.2 Fallback Path Exercised & Verified
In our test suite (`tests/unit/t3-2-locator-robustness.test.ts` and `tests/integration/t3-1-replay-executor.test.ts`):
- **Scenario:** The target application re-deploys, regenerating the Search button's ID from `#ctl00_MainContent_btnSearch_329a` to `#ctl00_MainContent_btnSearch_887b`.
- **Result:** The stale structural CSS selector fails. The targeting engine seamlessly falls back to **Tier 1 (Semantic: role="button", name="Search")** or **Tier 2 (Anchor: "Search")**, locating the element and successfully executing the click without manual intervention.

---

## 4. Replay Result Contract & Error Taxonomy (ADR-003)
Deterministic replay strictly segregates technical crashes from business outcomes into four explicit classes:
1. `SUCCESS`: Happy-path completion meeting checkpoint criteria and output extractions.
2. `BUSINESS_OUTCOME`: Expected domain end-states (e.g., `MEMBER_NOT_FOUND`, `ACCOUNT_SUSPENDED`).
3. `RECOVERABLE_RUNTIME_CONDITION`: Transient runtime blockers that can be cleared (e.g., `MODAL_OCCLUSION`, `TRANSIENT_TIMEOUT`).
4. `HARD_FAILURE`: Fatal stop conditions requiring debugging (e.g., `GUARDRAIL_VIOLATION`, `TARGETING_EXHAUSTED`).

---

## 5. Human Escalation & Session Handoff
When automation is halted by unresolvable state, control transfers seamlessly to a human operator via the `SessionCoordinator` state machine, allowing manual intervention before control is reconciled.

---

## 6. Safety Guardrails & Compliance (ADR-004)

Operating against low-affordance enterprise systems holding sensitive financial and healthcare records requires an uncompromising, defense-in-depth security posture. Guardrails are enforced at both discovery time and deterministic replay time.

### 6.1 Multi-Layered Allowlist Enforcement (T4.1)
The `GuardrailService` validates every step before execution across three orthogonal dimensions:
1. **Permitted Domains:** Only explicitly whitelisted hostnames (e.g. `localhost`, `*.enterprise.internal`) are reachable. Cross-origin redirections or external links are intercepted and rejected before network requests dispatch (`FORBIDDEN_DOMAIN`).
2. **Permitted Route Prefixes:** Navigation is confined to pre-approved application paths (e.g. `["/portal/search", "/portal/members"]`). Administrative, destructive, or debug routes (e.g. `/admin/danger`, `/portal/maintenance`) trigger a `FORBIDDEN_PATH` violation.
3. **Allowed Action Types:** Step primitives are constrained to an explicit capability allowlist (e.g. `["navigate", "click", "fill", "wait", "extract"]`). Arbitrary script evaluations or untrusted primitives are blocked (`DISALLOWED_ACTION_TYPE`).
4. **Structured Audit Logging:** Every blocked or flagged action automatically records an immutable `SecurityAuditEntry` capturing timestamp, action type, target URL, violation category, and reason.

### 6.2 Action Risk Taxonomy & Conservative Handling (T4.2 & ADR-004)
Actions are deterministically classified by `RiskClassifier` into three distinct risk tiers:
- **`LOW` (Safe / Reversible):** Idempotent or read-only actions (`navigate`, `hover`, `scroll`, `wait`, `extract`).
- **`MEDIUM` (Moderate / Stateful):** Reversible form inputs and non-destructive buttons (`fill`, `select`, `press`, search/filter clicks).
- **`HIGH_IRREVERSIBLE` (Risky / Irreversible):** Actions with destructive keywords (`delete`, `remove`, `purge`, `destroy`, `terminate`), financial impact (`transfer`, `wire`, `pay`, `checkout`), or dangerous styling (`btn-danger`).

#### Conservative Handling Modes
- **`BLOCK` (Autonomous Default - Fail-Closed):** High-risk actions are unconditionally aborted with a typed `HARD_FAILURE` (`HIGH_RISK_UNAUTHORIZED`), protecting production databases during headless runs.
- **`CONFIRM` (Human-in-the-Loop Gating):** Transfers control to a designated human operator via `SessionCoordinator` approval tokens.
- **`FLAG` (Audited Execution):** Permits execution only in authorized staging environments with full pre/post snapshot audit logging.

**Demonstrable Replay Defense:** In our proxy target fixture (`fixtures/legacy-portal/index.html`), attempting to click `#ctl00_btnDeleteMember` ("Purge Member Record") is intercepted at pre-action inspection and aborted, preventing database destruction.

### 6.3 Secrets & PII Redaction at Point of Capture (T4.3)
To ensure compliance with PCI-DSS, HIPAA, and GLBA, credentials, tokens, and PII are never persisted to disk:
1. **Pattern Scrubbing:** Deep regex filters scrub:
   - Social Security Numbers (`\b\d{3}-\d{2}-\d{4}\b` -> `[REDACTED_SSN]`)
   - Credit Cards (`\b(?:\d{4}[- ]?){3}\d{4}\b` -> `[REDACTED_CREDIT_CARD]`)
   - API Keys & Tokens (`sk-...`, `Bearer ...`, `AIza...` -> `[REDACTED_SECRET]`)
   - Emails & Phone Numbers (`[REDACTED_EMAIL]`, `[REDACTED_PHONE]`)
2. **Point of Capture:** Redaction is applied by `Redactor.redactDeep()` at the exact moment evidence is serialized:
   - Discovery DOM snapshots (`dom-snapshot-step-*.json`)
   - Discovery transcripts (`transcript.json`)
   - Synthesized artifacts (`synthesized-artifact.json`)
   - Replay failure manifests and snapshots (`evidence/replay-error/`)
3. **Verified Zero PII Retention:** Manual and automated audits (`tests/unit/t4-3-secrets-and-pii-redaction.test.ts`) confirm that customer PII (e.g. Alice Henderson's SSN `987-65-4321` in the legacy fixture table) is scrubbed to `[REDACTED_SSN]` with zero raw PII persisted in any artifact or log.
