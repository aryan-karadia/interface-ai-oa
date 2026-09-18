# ADR 0006: Human-in-the-Loop Escalation and Session Control Handoff

## Status
Proposed

## Context
Computer-use automation inevitably encounters situations where automation cannot or should not proceed autonomously:
- Low-confidence targeting or unresolvable layout ambiguity.
- Unexpected anti-bot, 2FA, or CAPTCHA challenge.
- High-risk or irreversible action requiring human authorization.
- Exceeded recovery retries on a critical business step.

The system must allow a human operator to take control of the **same live session** (same browser window, cookies, and local state), resolve the blocker, and return control to the automation engine seamlessly.

## Decision

We implement a dedicated `EscalationCoordinator` governing a strict **Session Ownership State Machine**:

```
[ AUTOMATION_OWNED ] 
         | 
         | (Trigger: Targeting exhausted, 2FA detected, or High-Risk action)
         v
[ AWAITING_TAKEOVER ] ----> Emits Escalation Request (CLI / Event Bus)
         |                  Freezes automation input dispatch
         |
         | (Operator acknowledges in CLI / UI)
         v
[ HUMAN_OWNED ] ----------> Unmutes human input on live Playwright session
         |                  Enables interactive inspection
         |
         | (Human completes task and clicks "Resume Automation")
         v
[ HANDOFF_RECONCILIATION ] -> Captures fresh Surface snapshot
         |                   Validates expected route / DOM invariant
         v
[ AUTOMATION_OWNED ]        Resumes artifact execution from current or next step
```

### Key Mechanisms

1. **Live Session Preservation:**
   Playwright runs in headed mode (or attaches via CDP). When escalation is requested, the session is kept active. A visual badge or banner is injected to signal human control.
2. **Contextual Escalation Payload:**
   The human operator receives:
   - Current Goal & Step ID
   - Failure / Escalation reason (e.g. `MFA_CHALLENGE_DETECTED` or `ACTION_REQUIRES_APPROVAL`)
   - Current URL and last perceived screenshot/accessibility state
   - Recommended human actions (e.g. "Please complete the SMS verification code, then press Enter").
3. **Reconciliation on Return:**
   Before automation resumes, `reconcileState(expectedPostCondition)` runs to verify that the human left the application in a valid state for the subsequent step.

## Consequences

### Positive
- Zero loss of progress: the human does not need to restart the entire workflow from scratch.
- Clear audit log documenting which actions were automated vs performed by human operator.
- Prevents race conditions where automation and human simultaneously dispatch keyboard/mouse events.

### Negative / Trade-offs
- Requires maintaining an active browser session during operator wait time (with appropriate timeouts).
