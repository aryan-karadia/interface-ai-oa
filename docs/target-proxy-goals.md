# Target Proxy Specification & Goal Candidates

## 1. Overview
The target surface proxy is **"LegacyCore Portal"**, an embedded enterprise web application designed to mirror legacy corporate systems (e.g. ASP.NET WebForms, Oracle Siebel, SAP WebGUI).

## 2. Hostile Low-Affordance Characteristics
1. **No Semantic HTML:** All layouts are rendered inside nested `<table><tr><td>` structures; buttons are clickable `<span>` elements without ARIA roles; inputs sit next to loose text nodes with no `<label for="...">`.
2. **Volatile Dynamic IDs:** IDs follow ASP.NET WebForms conventions (e.g. `ctl00_MainContent_tabSearch_txtMemberId_8912`) that simulate changing hash suffixes across deployments.
3. **No Test IDs:** Zero `data-testid`, `data-qa`, or automation-friendly attributes.
4. **Embedded Legacy Iframes:** Sub-views and queues are isolated inside `<iframe id="ctl00_ifrClaimsQueue">`.
5. **Transient Occluding Overlays:** Modals and banners that occlude interactive elements, testing automated recovery before fatal failure.
6. **Explicit Business State Branches:** Form queries return explicit business alert states (such as "Record Not Found" and "Account Suspended") rather than crashing.
7. **PII and Sensitive Form Data:** Contains SSN, Date of Birth, and Policy Notes to test automated PII scrubbing.

---

## 3. Candidate Goals

### Goal 1: Happy Path Member Search & Extraction
- **Goal Statement:** `"Look up member 10042 in the Member Search portal and extract account balance and full legal name"`
- **Initial URL:** `http://localhost:3000/portal/search`
- **Expected Steps:**
  1. Locate search input adjacent to text `"Member ID:"`.
  2. Type `"10042"`.
  3. Click `"Search"` button (`#ctl00_MainContent_btnSearch_329a`).
  4. Assert results table is visible.
  5. Extract `fullName` (`Alice M. Henderson`) and `balance` (`$240.50`).
- **Success Contract:** `status: "SUCCESS"`

### Goal 2: Non-Existent Member Query (Business Outcome Separation)
- **Goal Statement:** `"Query member database for ID 99999 and record the business outcome"`
- **Initial URL:** `http://localhost:3000/portal/search`
- **Expected Steps:**
  1. Enter `"99999"` into the Member ID field.
  2. Click `"Search"`.
  3. Detect alert banner: `"Notice: No active member records found for search criteria."`
- **Success Contract:** `status: "BUSINESS_OUTCOME"`, `outcomeCode: "MEMBER_NOT_FOUND"` (NOT a timeout crash!).

### Goal 3: Suspended Member Query (Business Outcome Branch)
- **Goal Statement:** `"Query member database for ID 11111 and verify account restrictions"`
- **Initial URL:** `http://localhost:3000/portal/search`
- **Expected Steps:**
  1. Enter `"11111"` into the Member ID field.
  2. Click `"Search"`.
  3. Detect security notice: `"Security Notice: Member account suspended - Read only mode."`
- **Success Contract:** `status: "BUSINESS_OUTCOME"`, `outcomeCode: "ACCOUNT_SUSPENDED"`.

### Goal 4: Embedded Iframe Claims Queue Inspection
- **Goal Statement:** `"Access the claims queue iframe and extract pending claims count"`
- **Initial URL:** `http://localhost:3000/portal/claims`
- **Expected Steps:**
  1. Navigate to or switch to the embedded claims queue iframe (`#ctl00_ifrClaimsQueue`).
  2. Read claims table status.
- **Success Contract:** `status: "SUCCESS"`.
