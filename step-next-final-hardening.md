# STEP-NEXT — FINAL HARDENING

[STEP ID]
STEP-NEXT-HARDENING

[TASK TYPE]
controlled fix

[OBJECTIVE]
Apply the minimum required hardening fixes before production use.

This step is NOT feature development.
This step is NOT UI work.

This step must fix only the confirmed risks from settlement production validation:

1. block negative remainder / negative margin settlement writes
2. add missing actor_membership_id in order audit rows

Optional low-risk improvement:
3. distinguish settlement_adjusted_post_final from settlement_recalculated if clearly detectable without redesign

Do NOT expand scope beyond these items.

---

[CONFIRMED RISKS TO FIX]

### Risk 1 — negative remainder allowed
Current production logic can write:

marginAmount = grossTotal - tcAmount - managerAmount - hostessAmount - preSettlementTotal

If this becomes negative, production currently allows the write.
This must be blocked.

Required behavior:
- reject the write with explicit error
- do not create invalid settlement row
- do not silently continue

### Risk 2 — missing actor_membership_id in order audit
Current order_added audit row is missing actor_membership_id.
This must be added using existing authContext.membership_id.

---

[STRICT RULES]

### 1. No redesign
Do NOT change settlement formulas.
Do NOT change existing business rules.
Do NOT change lifecycle rules.

FAIL IF:
- formulas are modified
- payout logic is redesigned

---

### 2. Minimal scope only
Only touch files directly required for the two confirmed fixes.

FAIL IF:
- unrelated routes are modified
- UI files are touched
- schema files are touched

---

### 3. Negative remainder hard block
Before settlement write completes, if:

marginAmount < 0

the route must:
- stop processing
- return 409
- use stable error code/message
- avoid writing invalid data

Recommended error:
- error: "REMAINDER_NEGATIVE"

FAIL IF:
- negative margin/remainder can still be written

---

### 4. Audit completeness
Order audit rows must include:
- actor_profile_id
- actor_membership_id
- actor_role
- actor_type

FAIL IF:
- actor_membership_id still missing from order_added audit rows

---

### 5. No speculative hardening
Do NOT fix other potential issues unless directly required by the confirmed risks.

FAIL IF:
- extra refactors are introduced
- additional behavior changes are slipped in

---

[TARGET FILES]

Expected primary targets only:

- app/api/sessions/settlement/route.ts
- app/api/sessions/orders/route.ts

Optional third target only if clearly justified:
- app/api/sessions/settlement/finalize/route.ts

---

[FORBIDDEN FILES]

Do NOT modify:
- UI pages/components
- schema/migration files
- account management files
- printer files
- unrelated settlement files unless strictly necessary
- package.json
- package-lock.json
- tsconfig.json
- next.config.*

---

[IMPLEMENTATION REQUIREMENTS]

### A. Negative remainder guard
In settlement write path:

- compute marginAmount exactly as current logic does
- add explicit guard before write
- if marginAmount < 0:
  - return 409
  - structured JSON error
  - do not insert/update invalid settlement row

### B. Order audit membership id
In order audit insert:
- include actor_membership_id: authContext.membership_id ?? null

Use existing audit row structure.
Do not redesign audit schema.

### C. Optional audit action split
Only if the route can clearly tell post-final versioned adjustment from ordinary recalculation without broad rewrite:
- use settlement_adjusted_post_final for post-final new version path
Otherwise:
- leave unchanged
- mention as follow-up

---

[REQUIRED VERIFICATION]

Must run:

1. npx tsc --noEmit
2. npm run build

Must also verify in code review summary:

- negative remainder path now blocked
- invalid settlement row is not written
- order_added audit now includes actor_membership_id

If runtime execution is not performed, state that clearly.

---

[OUTPUT FORMAT]

Respond with exactly:

1. FILES CHANGED
2. HARDENING SUMMARY
3. NEGATIVE REMAINDER GUARD
4. AUDIT FIX SUMMARY
5. VALIDATION
6. RISKS / FOLLOW-UPS

---

[STOP CONDITIONS]

STOP after the two confirmed fixes are implemented and verified.

Do NOT:
- redesign settlement
- expand into runtime test framework
- modify UI
- add new features

This step is FINAL HARDENING ONLY.