# STEP-NEXT — SETTLEMENT PRODUCTION INTEGRATION

[STEP ID]
STEP-NEXT-SETTLEMENT-PROD

[TASK TYPE]
controlled validation

[OBJECTIVE]
Validate that the implemented settlement system matches the locked business rules and simulation results under real API and database conditions.

This step is NOT new feature development.
This step is NOT UI work.

This step verifies:
- production API correctness
- DB data consistency
- snapshot alignment
- cross-store settlement integrity
- audit correctness

---

[PREREQUISITE]

Use:
- implemented settlement API routes
- existing DB schema and data
- simulation results from previous step

DO NOT:
- invent new logic
- modify settlement formulas
- redesign system behavior

---

[SCOPE]

Validate the following using real system behavior:

1. session → settlement → receipt → closing flow
2. time pricing correctness (public/shirt/hyper/cha3)
3. liquor calculation correctness
4. lifecycle stage enforcement
5. adjustment policy enforcement
6. cross-store settlement correctness
7. audit logging correctness
8. snapshot consistency

---

[STRICT RULES]

### 1. No logic changes

This step is validation only.

FAIL IF:
- any formula is modified
- any rule is changed

---

### 2. Use real API routes

All validation must go through:
- existing /api routes
- NOT direct DB manipulation

FAIL IF:
- DB is modified directly for validation

---

### 3. No simulation logic

Do NOT reuse simulation logic for calculation.

Use simulation ONLY as expected baseline.

FAIL IF:
- simulation replaces production logic

---

### 4. Snapshot must be verified

Must verify consistency between:

- session data
- receipt snapshot
- settlement snapshot
- closing snapshot

FAIL IF:
- mismatch exists without audit explanation

---

### 5. Cross-store validation required

Must verify:

- store-level payable correctness
- manager pre-settlement reduction
- remainder calculation
- duplicate payout prevention

FAIL IF:
- remainder incorrect
- duplicate payout allowed

---

### 6. Audit must exist for all mutations

Verify:

- time adjustments
- settlement finalize
- post-final adjustment
- cross-store settlement

FAIL IF:
- any mutation missing audit log

---

[VALIDATION SCENARIOS]

Must execute real API scenarios:

### A. Time pricing

- public full / half
- shirt full / half
- hyper full / half
- cha3 boundary (9, 15)
- shirt greeting exception

---

### B. Lifecycle

- active session edit
- checkout preview
- checkout pending correction
- finalize settlement
- closed business day

---

### C. Adjustment

- correction before finalize
- correction after finalize (new version)
- correction after closing (restricted)

---

### D. Liquor

- normal sale
- sale at deposit floor
- attempt below deposit (must fail)

---

### E. Cross-store

- single manager pre-settlement
- multiple manager pre-settlement
- remainder tracking
- duplicate payout attempt

---

### F. Snapshot

- receipt vs settlement
- settlement vs closing
- audit explaining differences

---

[VALIDATION METHOD]

For each scenario:

1. execute API calls
2. capture response
3. read resulting DB state
4. compare against expected behavior (from design lock + simulation)
5. log result

---

[VALIDATION OUTPUT]

Must produce:

- total scenarios
- passed scenarios
- failed scenarios

For each failure:

- scenario id
- expected result
- actual result
- root cause

---

[REQUIRED VERIFICATION]

Must run:

- tsc --noEmit
- npm run build

Then execute validation scenarios.

---

[OUTPUT FORMAT]

Respond with exactly:

1. VALIDATION SCENARIO SUMMARY
2. API BEHAVIOR VERIFICATION
3. SNAPSHOT CONSISTENCY RESULTS
4. CROSS-STORE VALIDATION RESULTS
5. AUDIT VERIFICATION
6. FAILED SCENARIOS
7. RISKS / FOLLOW-UPS

---

[STOP CONDITIONS]

STOP after validation is complete.

DO NOT:
- modify business logic
- build new UI
- create new APIs
- rewrite settlement system

This step is SETTLEMENT PRODUCTION VALIDATION ONLY.