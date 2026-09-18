# ADR 0001: Tech Stack Selection

## Status
Proposed

## Context
We are designing a Computer-Use Automation System that discovers UI workflows using an LLM, serializes them into deterministic versioned artifacts, and replays them without an LLM. The system must interact with low-affordance enterprise web surfaces, provide strict safety guardrails (route allowlisting, risk classification, secret redaction), support human-in-the-loop escalation on live sessions, and return a strongly-typed execution contract distinguishing business outcomes from system failures.

We evaluated language runtimes, browser/computer-use drivers, and LLM orchestration strategies against our requirements:
1. **Strong compile-time and runtime type safety** for the artifact schema and execution results.
2. **Reliable UI perception and interaction** on surfaces lacking clean test IDs or semantic markup.
3. **Pluggable LLM integration** during discovery that can be completely omitted during replay.
4. **Minimal operational complexity** without heavy infrastructure or scaling plumbing.

## Decision

### 1. Language and Runtime: TypeScript on Node.js (v20+) / Bun
We selected **TypeScript** paired with Node.js and `tsx` (with Bun compatibility).
- **Runtime Schema Validation:** We use `zod` as the single source of truth for both TypeScript types and runtime JSON Schema serialization/validation of artifacts.
- **Strict Discriminated Unions:** TypeScript's type system natively expresses closed discriminated unions for our replay result contract (`SUCCESS`, `BUSINESS_OUTCOME`, `RECOVERABLE_RUNTIME_CONDITION`, `HARD_FAILURE`) and action types.
- **Alternatives Considered:**
  - *Python (3.11+ / Pydantic / Asyncio):* Python has rich AI SDKs and Pydantic is excellent. However, browser automation via Playwright in Python involves complex sync vs. async event loops when multiplexed with CLI interactivity and human escalation handoffs. TypeScript is the native language of browser automation and Chrome DevTools Protocol (CDP).
  - *Go:* Exceptional concurrency and single-binary distribution, but slower developer velocity for complex JSON schema manipulation and lacking mature browser automation bindings compared to Playwright TS.
- *What would make us choose differently:* If the core system needed deep local ML/vision model inference (e.g. local PyTorch/ONNX layout parsers) or heavy scientific computing, Python would be preferred.

### 2. Computer-Use Tooling: Playwright with Chrome DevTools Protocol (CDP) & Accessibility Tree
We selected **Playwright** operating in a hybrid Perception mode:
- **Primary Perception:** Chrome Accessibility Tree (`page.accessibility.snapshot()`) and DOM semantic tree. This provides accessible roles, names, descriptions, and bounding boxes even when CSS classes are obfuscated or IDs are auto-generated.
- **Secondary / Visual Perception:** Viewport screenshots with normalized bounding boxes and visual anchor proximity.
- **Action Driver:** Playwright's low-level `mouse`, `keyboard`, and `locator` primitives wrapped strictly behind our `Surface` abstraction.
- **Alternatives Considered:**
  - *Pure Coordinate / Screenshot-based OS control (e.g. PyAutoGUI, Anthropic Computer Use container):* Requires a dedicated display server, is brittle to display scaling, OS theme changes, and window focus shifts, and renders deterministic replay slow and flaky.
  - *Pure CSS/XPath Selector Automation (Selenium / Puppeteer vanilla):* Legacy enterprise UIs actively defeat static CSS selectors through dynamic generated IDs (`ctl00$MainContent$txt_89123`) and table nesting.
  - *Direct Accessibility Tree only (OS-level UIAutomation / AT-SPI):* High platform specificity (Windows vs macOS vs Linux); lacks cross-platform portability.
- *What would make us choose differently:* If the target app were a native Win32/C++ desktop app or Java Swing client without a web renderer, we would use OS-level accessibility APIs (e.g., Windows UI Automation / PyWinAuto).

### 3. LLM Provider and SDK: Pluggable Model Client (Anthropic Claude 3.5 Sonnet / OpenAI / Gemini / Mock)
We encapsulate model calls behind a clean `LLMClient` interface using structured tool-calling / JSON mode.
- **Primary Model for Discovery:** Anthropic Claude 3.5 Sonnet or Gemini 1.5 Pro / GPT-4o for complex multi-modal reasoning and plan decomposition.
- **Mock/Offline Provider:** Deterministic mock provider for local unit and integration tests without network or API key dependencies.
- **Replay Decoupling:** The Replay engine has **zero** dependency on the LLM SDK or model tokens.

## Consequences

### Positive
- Unified language for DOM/browser interaction, CLI UI, schema validation, and guardrails.
- High developer velocity and strict typing from schema definition to CLI execution.
- Fast, deterministic replay runs without network model latency.

### Negative / Trade-offs
- Browser execution requires Playwright browser binaries (`playwright install chromium`).
- Complex multi-frame legacy applications require careful frame-aware traversal in the `Surface` adapter.
