You are executing the final NOX operational verification round.

Ground truth:
- Phase 1 through Phase 7 are already completed successfully
- Core domain structure split is complete
- Current task is NOT refactoring
- Current task is simulation, validation, and failure discovery only

You must NOT redesign code in this round unless a failure is reproduced and the report explicitly identifies the minimal fix candidate.
Primary goal is to find breakpoints, race conditions, integrity failures, and scope leaks.

---

# CURRENT TASK

Execute ONLY:

FINAL SIMULATION + OPERATIONAL VALIDATION

---

# PRIMARY OBJECTIVE

Stress the current NOX system using realistic operating scenarios and identify:

- race conditions
- unread / last_message inconsistencies
- finalized mutation leaks
- settlement / receipt version mismatches
- participant action corruption
- cross-store remaining mismatch
- business day attribution errors
- inventory restore / decrement mismatch
- auth/store scope violations

Do not do architecture work in this round.
Do not broaden scope.
Do not speculate.
Use only code-evidenced conclusions and actual runnable verification where possible.

---

# REQUIRED VALIDATION SCENARIOS

## SCENARIO 1 — CHAT BURST
Target:
- chat rooms
- messages
- unread
- last_message ordering

Simulate:
- multiple room types mixed
- rapid consecutive messages in same room
- concurrent sends from multiple actors
- read operations during active message flow

Check:
- last_message correctness
- unread counter correctness
- room list ordering correctness
- read reset correctness
- duplicate / dropped message symptoms

---

## SCENARIO 2 — CHECKOUT RACE
Target:
- checkout boundary behavior

Simulate overlap between:
- checkout request
- order mutation
- participant mutation
- chat read/write

Check:
- whether checkout is correctly blocked or serialized
- whether settlement/receipt can be generated from stale intermediate state
- whether finalized state prevents later mutation

---

## SCENARIO 3 — PARTICIPANT 9-ACTION CHAIN
Target:
- participant action integrity

Run on same participant in sequence:
- cha3
- banti
- wanti
- category change
- deduction update
- waiter tip toggle
- unspecified fill
- time/price edit
- external name update

Check:
- payout recalculation correctness
- overwrite conflicts
- action ordering corruption
- audit continuity
- final participant state integrity

---

## SCENARIO 4 — SETTLEMENT RECALC LOOP
Target:
- LIVE settlement route stability

Simulate:
- repeated settlement recalculation on same session
- partial pre-settlement state
- repeated calls after order/participant edits

Check:
- version increment correctness
- snapshot overwrite behavior
- negative remainder guard
- finalize boundary correctness

---

## SCENARIO 5 — RECEIPT REBUILD LOOP
Target:
- receipt document builder + snapshot writer

Simulate:
- repeated receipt generation on same session
- participants with mixed display_name/external_name
- half-ticket cases
- multiple orders

Check:
- participant name priority
- half-ticket override consistency
- snapshot upsert consistency
- totals consistency
- document shape stability

---

## SCENARIO 6 — CROSS-STORE PARTIAL PAYOUT
Target:
- store-level-first remaining balance semantics

Simulate example flow:
- store total owed = 1,200,000
- manager early payout = 400,000
- remaining = 800,000
- additional payout
- cancel payout

Check:
- remaining balance correctness
- manager/store attribution correctness
- cancel rollback correctness
- summary consistency

---

## SCENARIO 7 — AUTH / SCOPE ISOLATION
Target:
- store_uuid + role boundary

Test access with:
- owner
- manager
- hostess
- different-store actor

Check:
- cross-store denial
- role-based denial
- owner-only financial route protection
- hostess visibility limitations
- same-store vs different-store behavior

---

## SCENARIO 8 — BUSINESS DAY EDGE
Target:
- explicit close-based business day rule

Simulate:
- session started before midnight
- still active after midnight
- operations before close
- operations after close

Check:
- business day attribution
- settlement day consistency
- receipt day consistency
- cross-store day lookup consistency

---

## SCENARIO 9 — INVENTORY CONSISTENCY
Target:
- order + restore semantics

Simulate:
- create
- update
- delete
- insufficient stock
- repeated mutation

Check:
- decrement correctness
- restore correctness
- reverse transaction correctness
- non-blocking restore behavior consistency
- inventory/audit mismatch

---

## SCENARIO 10 — COMPRESSED PEAK LOAD
Target:
- operational realism

Approximate realistic pressure:
- manager-heavy activity
- participant-heavy mutation
- chat-heavy concurrent writes
- settlement / receipt / cross-store activity mixed

Focus:
- concentrated load window
- contention points
- integrity under repeated concurrent requests

Check:
- response failures
- state mismatch
- duplicate writes
- counter drift
- remaining mismatch
- version/snapshot mismatch

---

# EXECUTION RULES

- Do NOT invent infrastructure that does not exist
- Use current local development/runtime capabilities only
- If full concurrency tooling is unavailable, simulate with the best practical repeated request method available
- Prefer reproducible cases over broad claims
- Do NOT silently modify code while testing
- If you find a bug, document:
  - exact reproduction steps
  - affected route(s)
  - expected result
  - actual result
  - likely root cause from code evidence
  - minimal fix surface

---

# REQUIRED OUTPUT

# FINAL SIMULATION REPORT

## 1. SCENARIOS RUN
- which scenarios were actually run
- which were partially run
- which could not be run and why

## 2. PASS / FAIL SUMMARY
- scenario 1: PASS/FAIL/PARTIAL
- scenario 2: PASS/FAIL/PARTIAL
- ...
- scenario 10: PASS/FAIL/PARTIAL

## 3. BUGS FOUND
For each bug:
- title
- severity (critical/high/medium/low)
- exact reproduction steps
- expected behavior
- actual behavior
- affected files/routes
- evidence
- likely root cause
- minimal fix candidate

## 4. INTEGRITY CHECK
- unread consistency
- last_message consistency
- finalized mutation safety
- settlement version consistency
- receipt snapshot consistency
- participant payout consistency
- cross-store remaining consistency
- business day consistency
- inventory consistency
- auth/store scope isolation

## 5. HOTTEST RISKS
- top 5 operational risks remaining after simulation

## 6. FIX PRIORITY
- P0 must-fix before production
- P1 should-fix soon
- P2 acceptable for controlled rollout

## 7. RECOMMENDED NEXT STEP
Only one:
- patch round required
or
- safe for controlled production rollout

---

# HARD CONSTRAINTS

- Do NOT do refactor work in this round
- Do NOT widen to new features
- Do NOT change formulas
- Do NOT change business rules
- Do NOT change API response contracts
- Do NOT claim confidence without direct evidence
- If unable to run a scenario fully, state exactly what was tested and what was not

---

# FINAL DECISION STANDARD

A route/system is NOT considered safe just because build passes.
It is considered safe only if:
- no integrity failure reproduced
- no critical scope leak found
- no money-flow mismatch found
- no finalized-state mutation leak found
- no unread/last_message corruption found under stress