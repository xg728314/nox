# STEP-NEXT — SETTLEMENT RELOCK BACKFILL

[STEP ID]
STEP-NEXT-SETTLEMENT-RELOCK-BACKFILL

[TASK TYPE]
controlled implementation + execution

[OBJECTIVE]
Recompute old draft receipts created under the legacy settlement formula so they conform to the relocked formula.

This step must:
- identify draft receipts still using the old formula
- recompute them through the live settlement path
- classify failures clearly
- produce a manual-fix queue for receipts that still fail the new invariant

This step is NOT a broad migration.
This step is NOT UI work.
This step is NOT dormant-system work.

Use only the live System A path.

---

[LOCK REFERENCE]

Must follow:
- STEP-NEXT-SETTLEMENT-FORMULA-LOCK
- STEP-NEXT-SETTLEMENT-FORMULA-IMPLEMENTATION

Do NOT deviate from those locks.

---

[LIVE PATH ONLY]

Use:
- app/api/sessions/settlement/route.ts
- live receipts table
- live draft receipts
- actual API-driven recompute path

DO NOT use:
- dormant normalized settlement infrastructure
- direct recomputation formulas outside the live calculator

FAIL IF:
- System B is used
- formulas are duplicated in the backfill script

---

[STRICT RULES]

### 1. Recompute through live path
Backfill must use the actual settlement endpoint or the exact live calculator path already used in production.

FAIL IF:
- the script reimplements settlement math on its own

---

### 2. Draft receipts only
Target only:
- receipts.status = 'draft'
- receipts whose snapshot formula_version is missing or not v2-relock

Do NOT modify finalized receipts.

FAIL IF:
- finalized receipts are changed

---

### 3. No deletion
Do NOT delete receipts, sessions, participants, or orders.

FAIL IF:
- historical rows are removed

---

### 4. Failure classification required
If a receipt still fails under the new invariant:
- do NOT force success
- do NOT bypass guard
- classify it into a manual-fix queue

Expected examples:
- manager/hostess labor split exceeds participant flow
- malformed participant payout rows
- missing linked source data

FAIL IF:
- failing rows are silently skipped without classification

---

### 5. Minimal scope
Touch only files needed for the backfill runner and any minimal support required.

Expected targets:
- scripts/backfill-settlement-relock.ts

Optional helper only if strictly required:
- minimal script utility file

FAIL IF:
- live route logic is redesigned here
- unrelated UI/API files are modified

---

[BACKFILL REQUIREMENTS]

### A. Selection criteria
Find receipts where:
- status = 'draft'
- AND (
  snapshot is null
  OR snapshot->>'formula_version' is null
  OR snapshot->>'formula_version' does not start with 'v2-relock'
)

### B. Recompute action
For each target receipt:
- identify its session_id
- call the live settlement create/recalc path
- allow the route to write updated totals/version/snapshot

### C. Success classification
Record:
- receipt_id
- session_id
- store_uuid
- old_version
- new_version
- result = recomputed

### D. Failure classification
If recompute fails:
- record receipt_id
- session_id
- store_uuid
- error code
- message
- failure category

Failure categories must include at least:
- REMAINDER_NEGATIVE
- SOURCE_DATA_MISSING
- SESSION_NOT_CLOSED
- BUSINESS_DAY_CLOSED
- UNKNOWN_ERROR

### E. Reporting
At end of run, output:

- total targets
- recomputed success count
- failed count
- failures by category
- sample failed rows
- store-by-store breakdown

### F. Dry-run option
Support:
- dry-run mode (selection only, no writes)
- execute mode (real recompute)

---

[REQUIRED VERIFICATION]

Must run:

1. npx tsc --noEmit
2. npm run build
3. dry-run summary
4. execute run summary (only if safe and explicitly run in this step)

Must verify:
- finalized receipts unchanged
- new formula_version present on recomputed receipts
- failures are classified
- no formula duplication inside the script

---

[OUTPUT FORMAT]

Respond with exactly:

1. FILES CHANGED
2. BACKFILL RUNNER SUMMARY
3. TARGET SELECTION SUMMARY
4. EXECUTION RESULTS
5. FAILURE CLASSIFICATION
6. VALIDATION
7. RISKS / FOLLOW-UPS

---

[STOP CONDITIONS]

STOP after the backfill runner is implemented and, if safe, executed with a clear summary.

DO NOT:
- bypass settlement guards
- rewrite formulas in the script
- modify finalized receipts
- activate dormant settlement infrastructure

This step is SETTLEMENT RELOCK BACKFILL ONLY.