# ADR 002: Artifact Schema Design & Capability Contract

## Status
Accepted

## Context
The primary objective of the Computer-Use Automation System is to turn an exploratory, stochastic LLM discovery run into a deterministic, reusable, serializable, typed **Capability Artifact**.
This artifact is the central architectural contract of the system (Sections 3.2 and 7). It must be:
1. **Executed without an LLM:** The replay executor must follow ordered steps deterministically with zero model inferences.
2. **Resilient against Low-Affordance Enterprise Surfaces:** Element targeting must survive dynamic ASP.NET IDs, table soup layouts, and unsemantic markup.
3. **Strictly Parameterized and Typed:** Input parameters must declare validation rules and sensitivity flags (PII scrubbing); outputs must define extraction paths.
4. **Discerning of Business Outcomes:** Must cleanly distinguish valid business end-states (e.g. "Record not found") from technical crashes.
5. **Versioned and Serializable:** Stored as human-reviewable JSON with explicit schema versioning.

## Decision

We define the artifact specification as a first-class declarative schema with the following core components:

```json
{
  "schemaVersion": "1.0.0",
  "id": "capability.unique.identifier",
  "name": "Human Readable Title",
  "description": "Natural language goal fulfilled by this capability",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "target": {
    "appId": "target-app-name",
    "entryUrl": "http://domain/path",
    "allowedDomains": ["domain"]
  },
  "inputs": {
    "paramName": {
      "type": "string | number | boolean",
      "description": "...",
      "required": true,
      "sensitive": false
    }
  },
  "outputs": {
    "outputName": {
      "type": "string | number | boolean | object",
      "description": "...",
      "sourceStepId": "step_id",
      "selector": { ... }
    }
  },
  "steps": [ ... ],
  "checkpoint": { ... }
}
```

### 1. Element/Control Targeting Strategy (`TargetingStrategy`) & Robustness Rationale
In legacy enterprise applications (ASP.NET, Siebel, SAP WebGUI), DOM classes and IDs are frequently volatile hashes (e.g. `ctl00_content_txtMember_89a2`). Relying on a single CSS or XPath selector guarantees replay failure.

We establish a **4-Tier Priority-Ordered Targeting Strategy (`TargetingStrategy`)**:
- **Tier 1: Semantic / Accessibility (`semantic`):**
  Matches accessible role and name (`role: "textbox"`, `name: "Member ID"`). In modern browsers, the accessibility tree remains stable across style changes.
- **Tier 2: Anchor Text Proximity (`anchor`):**
  Locates loose text labels (e.g. `"Member ID:"`) and resolves the adjacent form control (`direction: "right"`, `targetTag: "input"`). This overcomes lack of `<label for="...">` tags.
- **Tier 3: Structural Relative Path (`structural`):**
  Normalized relative XPath or stable CSS hierarchy excluding dynamic hash IDs.
- **Tier 4: Visual Bounding Box (`visualFallback`):**
  Normalized coordinates (`x, y, width, height` in 0.0-1.0 range) paired with reference perceptual hashing.

### 2. Typed Parameterization & Expressions
- Input parameters are typed (`string`, `number`, `boolean`).
- Sensitive parameters (`sensitive: true`) trigger automatic masking in logs, telemetry, and screenshots.
- Step actions interpolate parameters using declarative templates: `valueTemplate: "{{inputs.memberId}}"`.

### 3. Checkpoints & Business Outcome Separation
Traditional test automation conflates any missing element with an unhandled technical crash (`TimeoutError`). In business applications, querying a non-existent record (e.g. ID `99999`) legitimately renders an alert banner: *"No active member records found"*.
The checkpoint specification defines:
1. `successCondition`: Primary assertion verifying the happy-path result.
2. `businessOutcomes`: An array of explicit domain conditions (`element_visible`, `text_matches`, `url_matches`) paired with semantic outcome codes (e.g. `MEMBER_NOT_FOUND`, `ACCOUNT_SUSPENDED`). When matched, replay terminates immediately with a typed `BUSINESS_OUTCOME` rather than timing out.

---

## Alternatives Considered

### Alternative 1: Raw CDP / Puppeteer Recorded Macro Script
- *Description:* Record raw CDP event streams or Puppeteer code snippets (`page.click('#ctl00_btn_a9')`).
- *Why Rejected:*
  1. Brittle: breaks whenever dynamic ID hashes change on server restart.
  2. Unparameterized: hardcodes runtime input values.
  3. Security hazard: records plain-text credentials and PII in keystroke logs.
  4. Binary failure mode: any unexpected dialog causes a low-level crash with no fallback or business outcome classification.

### Alternative 2: Flat Key-Value Action Dictionary
- *Description:* A simple list of selector-to-value mappings without branching, recovery policies, or assertions.
- *Why Rejected:* Cannot express multi-page navigation, conditional recovery, output extraction, or business outcome discrimination.

---

## Consequences

### Positive
- **Deterministic Zero-LLM Replay:** Replay executes in milliseconds with zero token cost.
- **Resilience:** If one targeting tier fails due to a UI patch, lower tiers automatically resolve the element.
- **Safe & Auditable:** Declarative parameterization keeps secrets and PII out of version-controlled artifact files.
- **Domain-Aware Observability:** Upstream systems receive clean business domain responses (`BUSINESS_OUTCOME`) instead of false-alarm error alerts.

### Negative / Trade-offs
- The discovery compiler must perform synthesis to transform raw agent actions into parameterized template expressions.
