# STEP-NEXT — SETTLEMENT CORE CONSOLIDATION (SAFE)

[STEP ID]
STEP-NEXT-SETTLEMENT-CONSOLIDATION

[TASK TYPE]
controlled refactor (safe, minimal)

[OBJECTIVE]
Eliminate settlement calculation drift by enforcing a single source of truth for all settlement math.

This step must:
- remove duplicated settlement calculation from finalize route
- ensure settlement is calculated ONLY in settlement/route.ts
- ensure finalize route does NOT recompute any monetary values

This step must NOT:
- redesign formulas
- change business rules
- introduce new features
- restructure the entire project

---

[PROBLEM STATEMENT]

Current state:
- settlement calculation exists in multiple places:
  - settlement/route.ts
  - settlement/finalize/route.ts
  - [session_id]/settlement/route.ts
  - lib/settlement/computeSessionShares.ts

Confirmed issue:
- settlement/route.ts uses preSettlementTotal
- finalize/route.ts does NOT
→ drift already exists

---

[GOAL]

Define a single source of truth:

👉 settlement/route.ts is the ONLY place where:
- gross_total
- tc_amount
- manager_amount
- hostess_amount
- margin_amount

are calculated.

All other routes MUST use the already computed values.

---

[STRICT RULES]

### 1. No formula change
Do NOT modify:
- tc calculation
- margin calculation
- payout logic
- liquor logic

FAIL IF:
- any formula is altered

---

### 2. finalize must NOT compute
In finalize/route.ts:

- REMOVE any recalculation logic
- REMOVE duplicated computation of:
  - grossTotal
  - tcAmount
  - managerAmount
  - hostessAmount
  - marginAmount

Instead:
- READ values from existing settlement row

FAIL IF:
- finalize still calculates monetary values

---

### 3. settlement is source of truth

settlement/route.ts must remain unchanged in logic.

It is the canonical calculator.

FAIL IF:
- logic moved away from settlement route
- multiple calculators remain

---

### 4. preserve lifecycle behavior

Finalize must still:
- validate session status
- enforce business day rules
- lock settlement
- write snapshot
- write audit

Only calculation must be removed.

FAIL IF:
- lifecycle behavior changes

---

### 5. no schema change

Do NOT:
- add new columns
- modify DB schema

---

### 6. minimal diff only

Only touch:

- app/api/sessions/settlement/finalize/route.ts

Optional:
- app/api/sessions/[session_id]/settlement/route.ts (only if needed to align)

FAIL IF:
- large refactor introduced
- unrelated files modified

---

[IMPLEMENTATION REQUIREMENTS]

### A. Identify duplicate calculation

Find block in finalize/route.ts:

- grossTotal calculation
- tcAmount calculation
- managerAmount aggregation
- hostessAmount aggregation
- marginAmount calculation

---

### B. Remove calculation

Delete those computations.

---

### C. Replace with DB read

Use existing settlement row:

Example pattern:

- fetch latest settlement row (version)
- read:
  - gross_total
  - tc_amount
  - manager_amount
  - hostess_amount
  - margin_amount

---

### D. Preserve guard

Negative remainder guard must still exist:

if (margin_amount < 0)
→ return 409

But use stored value, not recomputed.

---

### E. Snapshot correctness

Snapshot written in finalize must reflect:

- stored settlement values
- not recomputed values

---

[REQUIRED VERIFICATION]

Must confirm:

1. finalize no longer computes values
2. finalize uses DB settlement values
3. settlement route still computes values
4. no formula difference exists anywhere else
5. tsc passes
6. build passes

---

[OUTPUT FORMAT]

Respond with exactly:

1. FILES CHANGED
2. CONSOLIDATION SUMMARY
3. REMOVED CALCULATION POINTS
4. FINALIZE BEHAVIOR AFTER CHANGE
5. VALIDATION
6. RISKS / FOLLOW-UPS

---

[STOP CONDITIONS]

STOP after consolidation is complete.

DO NOT:
- move logic to lib
- redesign settlement system
- change APIs
- modify UI

This step is SETTLEMENT CORE CONSOLIDATION ONLY.