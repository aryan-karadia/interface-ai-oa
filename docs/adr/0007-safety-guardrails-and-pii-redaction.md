# ADR 0007: Safety Guardrails and PII Redaction

## Status
Proposed

## Context
Autonomous computer-use agents with broad UI permissions present severe risks:
1. **Unrestricted Navigation:** An agent or malicious input could navigate outside intended enterprise boundaries (e.g. navigating to public internet, phishing domains, or restricted admin portals).
2. **Irreversible / Dangerous Actions:** Actions such as "Delete All Records", "Submit Wire Transfer", or "Drop Database" could be executed autonomously without human consent.
3. **Sensitive Data Exposure:** Form inputs, transcripts, and replay artifacts could capture and persist sensitive PII (SSN, credit card numbers, passwords, auth tokens) in plain text.

Guardrails must be enforced deterministically for **both** LLM-driven discovery and replay runs.

## Decision

We implement an explicit `GuardrailService` intercepting all operations before they reach the `Surface` and before any artifact or log is serialized to disk:

### 1. Route & Domain Allowlisting
- Configured via explicit policy: `allowedDomains: ["localhost", "127.0.0.1", "legacy-core.internal"]` and `allowedPathPrefixes: ["/portal/search", "/portal/members"]`.
- Navigation actions or links violating the allowlist trigger an immediate `GUARDRAIL_VIOLATION` halt.

### 2. Action Risk Classification Engine
Actions are classified by risk tier:
- `LOW`: Read-only navigation, element inspection, clicking tab/pagination, focusing inputs.
- `MEDIUM`: Filling search forms, filtering data, toggling view modes.
- `HIGH_IRREVERSIBLE`: Clicking buttons labeled "Delete", "Purge", "Transfer Funds", "Submit Final Application".
- *Policy:* High-risk actions require an explicit pre-execution approval token (either configured in policy or dynamically obtained via the Escalation Coordinator).

### 3. PII & Secret Redaction Engine
- **Pattern-based scrubbing:** Regular expressions for SSNs (`\d{3}-\d{2}-\d{4}`), Credit Cards (`\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}`), Passwords, and API Keys.
- **Schema-declared masking:** Parameters marked with `sensitive: true` in the Artifact schema are automatically masked (`[REDACTED_INPUT:<paramName>]`) in logs, telemetry, and screenshots (via DOM blurring or black-box overlays).

## Consequences

### Positive
- Defense-in-depth: Even if an LLM is hallucinating or prompt-injected, the execution engine physically refuses to navigate to unauthorized URLs or execute destructive actions without escalation.
- Compliance: Artifacts and logs stored in the repository remain compliant with data privacy regulations.

### Negative / Trade-offs
- Overly strict regex or keyword matching can occasionally flag benign actions as high-risk, requiring human confirmation.
