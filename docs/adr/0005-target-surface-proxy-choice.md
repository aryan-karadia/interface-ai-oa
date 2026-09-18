# ADR 0005: Target Surface Proxy Choice

## Status
Proposed

## Context
The goal of this assignment is to prove the architecture holds up against **legacy, low-affordance enterprise UIs** (no clean DOM, dynamic server-generated IDs, unsemantic table layouts, no test IDs, nested iframes, modal popups, sensitive PII inputs).

Testing against a live third-party public website (e.g. an airline, live government portal, or bank) has fatal flaws for an evaluation assignment:
1. Unreproducible and flaky (IP rate limits, bot detection, CAPTCHAs, unannounced UI changes, network outages).
2. Live auth/credentials and potential terms-of-service violations.
3. Inability to deterministically seed and verify edge cases (e.g. inducing a specific "Member Suspended" business outcome, or testing modal interruptions).

We need a concrete, zero-dependency proxy surface that accurately mimics legacy enterprise architectures.

## Decision

We choose **"LegacyCore Portal" (an embedded, purpose-built legacy enterprise web application)** bundled directly in the repository (under `/fixtures/legacy-portal/` or served via lightweight local HTTP server).

### Architecture & Pathologies of the Proxy Target
The LegacyCore Portal is modeled after legacy ASP.NET WebForms / Oracle Siebel / SAP WebGUI intranet portals with the following realistic enterprise design characteristics:

1. **Obfuscated Dynamic IDs:** Form inputs and buttons have generated ASP.NET-style names and IDs (e.g. `id="ctl00_MainContent_tabContainer_pnlSearch_txtMemberId_892b1"` that changes on re-render).
2. **Table-based Layout Soup:** Navigation, forms, and results are laid out in deeply nested `<table><tr><td>` structures with no `<nav>`, `<main>`, or semantic markup.
3. **Low-Affordance Elements:** "Buttons" rendered as `<span class="btn-fake" onclick="...">Search</span>` without `<button>` tags or ARIA roles; inputs placed next to raw text nodes (`"Member ID: "` without `<label for="...">`).
4. **Transient Modals and Popups:** Simulated session-expiry warnings, promotion banners, and confirmation modals that occlude the view and test the `RecoverableCondition` system.
5. **Legitimate Business Domain States:**
   - *Valid Member:* Returns member details, claims history, and balance.
   - *Non-Existent Member (ID `99999`):* Renders an enterprise alert banner `"Information: No active member records found for search criteria"` (testing the `BUSINESS_OUTCOME` separation).
   - *Suspended Member (ID `11111`):* Displays a high-risk security warning and disables export actions.
6. **PII and Sensitive Fields:** Contains SSN, Date of Birth, and Policy Notes to validate the PII redaction and secret-masking guardrails.
7. **Multi-Step Complex Workflow:** Member Search -> Detail Verification -> Note Update -> Save & Confirm.

### Why This Reasoning Holds Up
- **Decoupled Verification:** By proving that our multi-tier targeting strategy (Accessibility Role/Name -> Anchor Text Proximity -> Structural XPath -> Visual Bounding Box) can automate this messy, non-semantic portal deterministically, we demonstrate that the architecture works against real-world legacy enterprise software.
- **Offline & Zero Flakiness:** Runs 100% locally on localhost without requiring internet or API credentials to execute replay regression tests.
- **Controlled Invariants:** Enables automated integration tests verifying all 4 replay result states (`SUCCESS`, `BUSINESS_OUTCOME`, `RECOVERABLE_RUNTIME_CONDITION`, `HARD_FAILURE`).

## Consequences

### Positive
- Fully reproducible in any CI or grading environment with zero external dependencies.
- Perfect fidelity for testing edge cases, PII redaction, human escalation, and recovery.

### Negative / Trade-offs
- Requires maintaining a small self-contained HTML/CSS/JS fixture app (~250-350 LOC, zero external npm dependencies).
