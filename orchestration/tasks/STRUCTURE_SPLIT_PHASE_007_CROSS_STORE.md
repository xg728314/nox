You are executing the next locked NOX structure split task.

Use the latest completed execution results as ground truth:
- Phase 1–6 completed successfully
- Core domains extracted:
  - settlement ✔
  - orders ✔
  - participants ✔
  - receipt ✔
  - chat ✔
- All invariants preserved:
  - auth/store scope
  - settlement semantics
  - response shapes
- validation passed in prior phases:
  - npx tsc --noEmit
  - npm run build

Do not redo earlier phases.
Continue from the current codebase state only.

---

# CURRENT TASK

Execute ONLY:

PHASE 7 — Cross-store domain boundary extraction

---

# TARGET

C:\work\nox\app\api\cross-store\

Primary routes likely include cross-store settlement / work-record related routes.
Use the actual LIVE routes present in the codebase.
Do not invent missing routes.

---

# PRIMARY OBJECTIVE

Separate cross-store logic into a proper domain structure:

- store-level obligation calculation flow
- manager/store payout state transitions
- pre-settlement partial deduction flow
- ledger / remaining balance transitions

Make routes thin controllers.

---

# REQUIRED TARGET STRUCTURE

C:\work\nox\lib\cross-store\

  services\
    loadObligationState.ts
    applyPreSettlement.ts
    transitionPayoutState.ts
    buildSettlementSummary.ts

  state-machine\
    payoutStateMachine.ts

  validators\
    validateCrossStoreInput.ts
    validatePayoutTransition.ts

  queries\
    loadCrossStoreScoped.ts

  types.ts

You may adjust file count slightly if needed, but preserve this boundary intent.

---

# HARD RULES

- NO behavior change
- NO settlement formula change
- NO store-level total meaning change
- NO partial pre-settlement meaning change
- NO manager/store payout meaning change
- NO auth/store scope change
- NO API path change
- NO response shape change
- NO schema change
- DO NOT touch dormant settlement system
- DO NOT broaden into BLE/simulation
- DO NOT redesign cross-store policy
- DO NOT introduce speculative abstractions

---

# REQUIRED EXTRACTION STRATEGY

## 1. loadObligationState.ts
Extract reusable loading/orchestration logic for current cross-store settlement state, such as:
- current obligation row(s)
- same-store / target-store scope checks
- current remaining amount
- related manager/store payout context

Keep semantics identical.

## 2. applyPreSettlement.ts
Extract partial pre-settlement logic already present in LIVE code, such as:
- apply early payout to manager
- reduce remaining store-level amount
- preserve current deduction/write order
- preserve current validation/error semantics

## 3. transitionPayoutState.ts
Extract status transition logic already present in LIVE routes, such as:
- unpaid → partial
- partial → settled
- invalid transition rejection
- status write payload building

Do not invent a new state model.
Only formalize the one already in code.

## 4. buildSettlementSummary.ts
Extract response-building / summary composition logic if routes currently duplicate:
- store-level total
- manager-level breakdown
- remaining amount
- pre-settlement history or status fields

Keep field names and meaning unchanged.

## 5. payoutStateMachine.ts
Create a narrow state-machine helper only if the LIVE code already has repeated transition rules.
This file must:
- encode existing valid transitions only
- reject invalid transitions only as current code already does
- avoid adding new statuses

## 6. Validators
### validateCrossStoreInput.ts
Extract request/input validation only where duplicated and stable:
- UUID checks
- amount validation
- required fields
- target store / target manager references

### validatePayoutTransition.ts
Extract repeated transition validation only if duplicated.

## 7. Queries
### loadCrossStoreScoped.ts
Extract same-store / cross-store scope-safe DB loads.
Must preserve existing store_uuid filtering semantics exactly.

---

# ROUTE END STATE

routes must only contain:

- request parse
- auth / role guard
- validator calls
- query / service calls
- response mapping
- error mapping

NO business logic inside route.

---

# IMPORTANT CONSTRAINTS

## DO NOT TOUCH
- cross-store money meaning
- store-level-first grouping rule
- pre-settlement deduction semantics
- manager payout attribution
- response JSON field names

## DO NOT ADD
- new statuses
- new payout formulas
- new ledger concepts
- background jobs
- async queue
- speculative retries

## DO NOT FIX LOGIC
If you see a bug or awkward rule:
- preserve it
- report it
- DO NOT change behavior

---

# VALIDATION REQUIRED

Before final response:

- npm run tsc --noEmit
- npm run build

---

# OUTPUT FORMAT

# ROUND XXX — STRUCTURE SPLIT PHASE 7 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what logic moved to loadObligationState.ts
- what logic moved to applyPreSettlement.ts
- what logic moved to transitionPayoutState.ts
- what logic moved to buildSettlementSummary.ts
- whether payoutStateMachine.ts was created and why
- what remained in routes

## 3. SAFETY CHECK
- store-level total meaning untouched: YES/NO
- pre-settlement semantics untouched: YES/NO
- payout status semantics untouched: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO
- dormant settlement untouched: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL

## 5. ROUTE SIZE IMPACT
- [route] before → after
- [route] before → after

## 6. REMAINING HOTSPOTS
- unresolved cross-store risks
- concurrency or money-flow risks
- remaining large files

## 7. NEXT RECOMMENDED STEP
- Phase 8 only