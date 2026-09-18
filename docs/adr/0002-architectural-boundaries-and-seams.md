# ADR 0002: Architectural Boundaries and Seams

## Status
Proposed

## Context
A computer-use automation system faces severe architectural failure modes if layers are coupled:
- If replay is coupled to the LLM, runs become non-deterministic, slow, expensive, and flaky.
- If high-level execution logic couples directly to browser drivers (Playwright), the system cannot be tested without a real browser, cannot support non-web surfaces (desktop/terminal), and leaks low-level driver errors into business logic.
- If discovery transcripts are conflated with execution artifacts, the artifact becomes a bloated log of agent mistakes, retries, and hallucinations rather than a clean, canonical capability definition.
- If guardrails are implemented as ad-hoc checks inside the LLM prompt or inside the browser driver, malicious or buggy runs can bypass policies.
- If human escalation is an afterthought, automation and human inputs clash, causing race conditions and lost session state.

## Decision

We establish five explicit architectural boundaries with unidirectional dependency flow:

```
                      +-------------------+
                      |   Discovery LLM   |
                      |     (Agent)       |
                      +---------+---------+
                                | synthesizes
                                v
+------------------+     +---------------+     +--------------------+
| Live User Inputs | --> | Artifact Spec | <-- | Artifact Repository|
+------------------+     +-------+-------+     +--------------------+
                                 |
                                 v
                       +-------------------+
                       |  Replay Executor  |
                       +---------+---------+
                                 |
                                 v
                       +-------------------+
                       | Guardrail / Policy| (Allowlist, Risk, Redact)
                       +---------+---------+
                                 |
                                 v
                       +-------------------+
                       | Escalation Layer  | (Control: Automation vs Human)
                       +---------+---------+
                                 |
                                 v
                       +-------------------+
                       | Surface Interface | (perceive, act, snapshot)
                       +---------+---------+
                                 |
                                 v
                       +-------------------+
                       | Playwright Driver |
                       | (Concrete Target) |
                       +-------------------+
```

### Boundary 1: Surface Abstraction (`perceive` / `act`)
The `Surface` interface defines the minimal contract for observing and manipulating any UI:
- `perceive(): Promise<SurfaceSnapshot>` (visual frame, accessibility tree, URL/route, active element, interactive nodes)
- `act(action: SurfaceAction): Promise<ActionResult>` (click, fill, press, select, hover, scroll)
- `locate(targeting: TargetingStrategy): Promise<ElementHandle>`
- `pauseForHuman(): Promise<void>` and `resumeFromHuman(): Promise<SurfaceSnapshot>`
- **What would break if Replay depended directly on Playwright:**
  1. Unit and contract testing would require running real Chromium instances, slowing test suites from milliseconds to minutes.
  2. The system could never automate desktop or mobile surfaces without rewriting the replay engine.
  3. Low-level driver exceptions (e.g. `TargetClosedError`, `TimeoutError`) would leak into domain logic rather than being translated into structured `RecoverableCondition` or `HardFailure`.

### Boundary 2: Artifact Schema vs. Discovery Transcript
- The **Discovery Transcript** is an append-only log of LLM turns, tool invocations, intermediate thoughts, failed attempts, and perception snapshots.
- The **Artifact** is a distilled, typed, validated, and versioned specification representing the *canonical success path*, parameter bindings, targeting strategies, and assertion checkpoints.
- **What would break if conflated:** Replay would replay dead-ends, retries, and exploratory misclicks made during discovery. Artifacts would be massive (megabytes of screenshots/chat history) and could not be statically inspected, linted, or parameterized.

### Boundary 3: Replay Executor Decoupled from the LLM
The Replay Executor evaluates artifacts deterministically:
`ReplayExecutor.run(artifact, params, surface) -> ReplayResult`
- It uses only the Artifact schema, the input parameter map, and the `Surface` abstraction.
- **What would break if Replay used an LLM in the decision loop:**
  1. Determinism would drop: identical inputs on identical UI states could produce different actions.
  2. Latency would increase by 10x-50x (waiting for model inference on every click).
  3. Token costs would scale linearly with replay frequency.
  4. Failure auditing becomes non-reproducible.

### Boundary 4: Unified Guardrail / Policy Layer
Both Discovery and Replay must route all perception and actions through a central `GuardrailService`:
- **Pre-Action Allowlist:** Validates URLs, target origins, and permitted action types before any action touches the Surface.
- **Risk Classification:** Classifies actions as `LOW`, `MEDIUM`, `HIGH_IRREVERSIBLE` (e.g. Delete, Submit Payment, Bulk Overwrite). Actions deemed irreversible require explicit escalation confirmation or are rejected if unauthorized.
- **Redaction Engine:** Scrubs PII, auth headers, and secrets from perceived state, artifact definitions, and execution logs.
- **What would break if guardrails were just prompt instructions:** The LLM can hallucinate or be prompt-injected into ignoring guardrails; replay (which lacks an LLM) would have zero protection.

### Boundary 5: Escalation and Control-Owner State Machine
A dedicated `SessionControlCoordinator` manages the session lifecycle:
- State machine: `AUTOMATION_CONTROL` <--> `AWAITING_HUMAN_TAKEOVER` <--> `HUMAN_CONTROL` <--> `HANDOFF_VALIDATION` <--> `AUTOMATION_CONTROL`.
- When an action or checkpoint triggers escalation, automation execution pauses, the browser session remains open, context is exported to the operator CLI, and input events pass through to the human.
- Control is safely reclaimed only after the human confirms handoff and the Surface snapshot is reconciled.
- **What would break if escalation were ad-hoc:** Concurrency bugs, race conditions (automation clicking while human types), and desynchronized session state.

## Consequences

### Positive
- Strict separation of concerns allows mock-testing each layer in isolation.
- Zero-token replay execution guarantees predictable operating costs and sub-second step latency.
- Security and safety are enforced deterministically at the architectural boundary.

### Negative / Trade-offs
- Additional boilerplate interfaces and adapter layers.
- Requires mapping Playwright-specific capabilities (like CDP sessions) into the generic `Surface` interface.
