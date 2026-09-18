# Computer-Use Automation System

A production-grade, two-phase computer-use automation platform engineered for low-affordance, hostile legacy enterprise web surfaces (unsemantic HTML tables, volatile server-generated IDs, occluding modal overlays, and unlabelled controls).

The system decouples **LLM-guided discovery** from **zero-LLM deterministic replay**, backed by an immutable typed capability schema, human-in-the-loop escalation state machine, and fail-closed safety guardrails with point-of-capture PII scrubbing.

---

## Key Highlights

- **Two-Phase Decoupled Architecture:** Autonomous LLM observe–decide–act exploration compiles once into a versioned capability artifact; subsequent production runs execute with **zero LLM inference in the loop**.
- **4-Tier Targeting Fallback Chain:** Resolves dynamic enterprise DOM churn via `Semantic (ARIA)` &rarr; `Anchor (Label Proximity)` &rarr; `Structural (Normalized CSS/XPath)` &rarr; `Visual (Coordinate Bounding Box)`.
- **Typed Result Contract & Error Taxonomy (ADR-003):** Strictly isolates expected domain terminal states (`BUSINESS_OUTCOME` e.g., `MEMBER_NOT_FOUND`) from transient technical issues (`RECOVERABLE_RUNTIME_CONDITION`) and fatal exceptions (`HARD_FAILURE`).
- **Human-in-the-Loop Escalation State Machine (ADR-005):** Seamless 4-stage ownership transfer (`AUTOMATION_OWNED` &harr; `HUMAN_OWNED`) preserving live Playwright Chromium browser state, cookies, and DOM context.
- **Fail-Closed Safety & Point-of-Capture Scrubbing (ADR-004):** Domain, route prefix, and action allowlists; action risk classification (`LOW`, `MEDIUM`, `HIGH_IRREVERSIBLE`); and automated zero-retention PII/secret redaction (`[REDACTED_SSN]`).

---

## 1. Prerequisites & Installation

### Runtime Requirements
- [Bun](https://bun.sh) (v1.1+ or higher)
- Chromium browser binaries for Playwright

### Setup Commands
```bash
# 1. Clone the repository and enter directory
git clone https://github.com/aryankaradia/interface-ai-oa.git
cd interface-ai-oa

# 2. Install dependencies
bun install

# 3. Install Playwright browser dependencies (Chromium)
bun x playwright install chromium
```

---

## 2. Configuration & Execution Modes

The system operates in two modes:

### Mode A: Offline Mock Mode (Zero Setup / No API Key Needed)
Run entirely offline without any external network dependency or LLM API keys. The deterministic mock planner guides discovery, synthesizes artifacts, and executes zero-LLM replay:
```bash
bun run start discover --mock --headed
```

### Mode B: Live Google Gemini Mode
To run discovery against live multi-modal Gemini (Gemini 3.6 Flash / Flash-Latest with automatic retry and model failover):
1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Set your Gemini API key in `.env`:
   ```bash
   GEMINI_API_KEY="your-gemini-api-key-here"
   ```
   *(Or pass directly via `--api-key <key>` or command line: `GEMINI_API_KEY="your_key" bun run start discover --headed`)*

---

## 3. Exact Demo Command Sequence

Follow this sequence to experience the full vertical slice:

### Step 1: Run Discovery Agent on Goal
Launch the discovery agent against the hostile `LegacyCore Portal` fixture. If the fixture server is not already running on `localhost:3000`, the CLI **automatically starts the local server** on demand:

```bash
# Offline demonstration (recommended for immediate evaluation):
bun run start discover --mock --headed

# OR with Live Gemini:
GEMINI_API_KEY="your_api_key" bun run start discover --headed
```
**What happens:**
1. Spawns Chromium and navigates to `http://localhost:3000/portal/search`.
2. Inspects unsemantic table layout and dynamic ASP.NET IDs (`#ctl00_MainContent_tabSearch_txtMemberId_8912`).
3. Inputs member ID `10042`, clicks the unsemantic `<span>` Search button (`#ctl00_MainContent_btnSearch_329a`).
4. Verifies member table appears and compiles the trace into `evidence/discovery/synthesized-artifact.json`.

---

### Step 2: Inspect the Compiled Capability Artifact
Inspect the typed contract, input schema, output extractions, 4-tier fallback targeting, and checkpoints:
```bash
bun run start inspect artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json
```

---

### Step 3: Replay Artifact Deterministically (Zero LLM)

#### 3a. Happy Path Replay (Alice Henderson - Member 10042)
Replay the artifact deterministically without any model calls in the loop:
```bash
bun run start replay artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json --inputs '{"memberId":"10042"}' --headed
```
**Result:** Executes in ~130ms, extracts `outputs.memberName = "Alice M. Henderson"`, and returns `status: "SUCCESS"`.

#### 3b. Exceptional Domain State Replay (Non-Existent Member 99999)
Demonstrate explicit domain outcome classification vs. technical crashes:
```bash
bun run start replay artifacts/legacy-core-portal/legacy.portal.lookup_member/v1.0.0.json --inputs '{"memberId":"99999"}'
```
**Result:** Returns `status: "BUSINESS_OUTCOME"`, `outcomeCode: "MEMBER_NOT_FOUND"`, capturing detected notice text without timing out or crashing.

---

### Step 4: Run Complete Test Suite
Verify all unit, integration, and security tests:
```bash
bun test
```
*Current test suite: **119 passing tests across 29 test suites**, verifying locator fallback, stopping conditions, guardrail allowlists, action risk policies, PII redaction, human handoff, and evidence completeness.*

---

## 4. Key Documentation & Artifacts

| Document / Directory | Description |
| :--- | :--- |
| [`REPORT.md`](file:///Users/aryankaradia/projects/interface-ai-oa/REPORT.md) | Comprehensive engineering report covering the **7 required Section 6 headings**: `Architecture`, `Artifact schema`, `Determinism & error handling`, `Heterogeneity & multi-tenant`, `Escalation & handoff`, `Safety`, and `Cuts`. |
| [`evidence/`](file:///Users/aryankaradia/projects/interface-ai-oa/evidence/) | Section 6 Deliverable #3 package containing: |
| &bull; [`evidence/discovery/`](file:///Users/aryankaradia/projects/interface-ai-oa/evidence/discovery/) | Discovery run transcript, synthesized artifact, DOM snapshots, visual screenshots, and structured logs. |
| &bull; [`evidence/replay/`](file:///Users/aryankaradia/projects/interface-ai-oa/evidence/replay/) | Successful replay run manifest, result (`SUCCESS`), replayed artifact, DOM snapshot, and structured logs. |
| &bull; [`evidence/replay-error/`](file:///Users/aryankaradia/projects/interface-ai-oa/evidence/replay-error/) | Exceptional-state replay result (`BUSINESS_OUTCOME: MEMBER_NOT_FOUND`), failure screenshot, DOM snapshot, and structured logs. |
| &bull; [`evidence/handoff/`](file:///Users/aryankaradia/projects/interface-ai-oa/evidence/handoff/) | Human intervention request, resolution, ownership timeline, post-handoff DOM/screenshot snapshots, and structured logs. |
| [`artifacts/`](file:///Users/aryankaradia/projects/interface-ai-oa/artifacts/) | Versioned, typed capability repository (`artifacts/<appId>/<capabilityId>/v<semver>.json` and `.md`). |
| [`docs/adr/`](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/) | Architecture Decision Records defending key design choices: |
| &bull; `ADR-0002` | [Architectural Boundaries & Seams](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/0002-architectural-boundaries-and-seams.md) |
| &bull; `ADR-002` | [Artifact Schema Design](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/ADR-002-artifact-schema-design.md) |
| &bull; `ADR-003` | [Result Contract & Error Taxonomy](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/ADR-003-result-contract-and-error-taxonomy.md) |
| &bull; `ADR-004` | [Risky vs. Reversible Action Policy](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/ADR-004-risky-vs-reversible-action-policy.md) |
| &bull; `ADR-005` | [Control Transfer & Human Escalation](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/ADR-005-control-transfer-and-human-escalation.md) |
| &bull; `ADR-0008` | [Artifact Storage & Versioning Layout](file:///Users/aryankaradia/projects/interface-ai-oa/docs/adr/0008-artifact-storage-and-versioning-layout.md) |

---

## 5. CLI Command Reference

```
bun run start <command> [options]

Commands:
  discover                  Run autonomous discovery observe-decide-act loop
                            --goal <text>       Natural language goal
                            --url <url>         Target app entry URL
                            --headed            Display visible browser window
                            --mock              Run offline mock planner (no API key required)
                            --api-key <key>     Provide Gemini API key directly
                            --evidence <dir>    Output folder for screenshots and artifacts
                            --max-steps <num>   Maximum steps before stopping (default: 8)

  replay <artifact.json>    Replay compiled artifact deterministically (zero LLM)
                            --inputs <json>     JSON string of input parameters
                            --headed            Display visible browser window
                            --evidence <dir>    Output directory for execution evidence

  validate <artifact.json>  Validate an artifact specification against schemas/artifact.schema.json
  list-artifacts            List versioned capabilities registered in repository (--app <appId>)
  inspect <file|app/id>     Inspect capability schema, inputs, outputs, targeting tiers, and checkpoints
  diff <file1> <file2>      Show semantic diff between two capability versions
  serve-proxy               Start the LegacyCore Portal fixture manually on localhost:3000
```
