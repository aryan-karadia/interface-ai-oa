# ADR 0008: Artifact Storage Layout, Versioning, and Run Separation

## Status
Accepted

## Context
The Computer-Use Automation System discovers capabilities through LLM-driven exploration and synthesizes them into deterministic, typed `ArtifactSpec` capability definitions.
To satisfy production evaluation standards (Sections 3.2, 5, and 7):
1. **Separation of Artifacts and Runs:** An "Artifact" is a reusable capability specification (the executable blueprint). An "Execution Run" is an ephemeral or auditable instance of executing an artifact with specific parameters, telemetry, and evidence. Conflating them leads to bloated repositories, secret leakage, and tangled version histories.
2. **Versioning Strategy:** Capabilities evolve as target enterprise applications change (e.g. DOM tweaks, new required fields). Versioning must follow semantic versioning (`major.minor.patch`), allowing consumers to pin stable releases or receive non-breaking improvements.
3. **Human Reviewability & Diffability:** Engineers and reviewers must be able to inspect what a capability does without reading minified JSON or stepping through code. Git-friendly diffs and auto-generated Markdown capability guides allow immediate peer review.

## Decision

### 1. Storage Layout
We organize capabilities in a predictable filesystem hierarchy:

```
artifacts/
└── <appId>/
    └── <capabilityId>/
        ├── capability.json        # Pointer to latest active version & metadata
        ├── v1.0.0.json            # Deterministically ordered, 2-space indented JSON
        ├── v1.0.0.md              # Auto-generated human-reviewable markdown spec
        ├── v1.1.0.json
        └── v1.1.0.md

runs/                              # STRICTLY SEPARATED from capabilities
└── <runId>/
    ├── run-manifest.json          # Artifact reference, inputs, timing, outcome
    ├── dom-snapshots/
    ├── screenshots/
    └── logs.ndjson
```

### 2. Separation of Artifacts and Runs
- **`artifacts/`**: Version-controlled repository of capability specifications. Zero runtime session state, zero customer PII, zero ephemeral logs. Only schema-validated, parameterized capability definitions.
- **`runs/` (or `evidence/`)**: Execution-time evidence, screenshots, DOM dumps, and telemetry. Ignored by version control or shipped to cold object storage (S3/GCS).

### 3. Versioning Strategy
- Semantic versioning: `major.minor.patch` (e.g. `1.0.0`).
  - **Patch (`1.0.1`):** Robustness improvements to element targeting tiers (e.g., improved anchor text fallbacks or adjusted timeouts) without changes to inputs/outputs contracts.
  - **Minor (`1.1.0`):** Backwards-compatible additions of optional inputs, new extracted outputs, or intermediate verification steps.
  - **Major (`2.0.0`):** Breaking changes to required inputs, removed outputs, or incompatible checkpoint assertions.
- When an artifact is saved without an explicit version, `ArtifactRepository` automatically increments the minor or patch version based on detected changes, or defaults to `1.0.0` for initial registration.

### 4. Human Reviewability & Diffability
- **JSON Formatting:** Deterministic key ordering and 2-space indentation ensure clean `git diff` output without noise.
- **Auto-Generated Markdown (`.md`):** Alongside every `.json` artifact, the repository generates a human-readable companion document summarizing:
  - Natural language capability goal and target app
  - Input parameters table (types, required, descriptions, sensitive flags)
  - Ordered execution steps with targeting strategy tiers and fallback rationale
  - Output extraction mappings
  - Checkpoints: Happy-path assertions and domain business outcomes (`BUSINESS_OUTCOME`)
- **Semantic Diff Tool (`diffArtifacts`):** Compares two versions of an artifact and highlights changed inputs, outputs, added/removed steps, and targeting modifications.

---

## Consequences

### Positive
- **Clear Separation of Concerns:** Repository stays clean, compact, and auditable while runtime runs can be archived independently.
- **Zero-Ambiguity Code Reviews:** Pull requests modifying capabilities show exact step and selector diffs in both JSON and Markdown.
- **Auditability & Compliance:** Sensitive data is kept out of artifact storage by design.

### Negative / Trade-offs
- Maintaining companion Markdown files requires continuous synchronization on write, handled automatically by `ArtifactRepository`.
