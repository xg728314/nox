# STEP-NEXT — RUNTIME VALIDATION

[STEP ID]
STEP-NEXT-RUNTIME-VALIDATION

[TASK TYPE]
controlled validation

[OBJECTIVE]
Execute real runtime validation against the implemented NOX API using a safe test/staging path.

This step is the final gate before production use.

Validate only the confirmed hardening and settlement-critical runtime behaviors:

1. negative remainder is blocked in settlement create/recalc
2. negative remainder is blocked in settlement finalize
3. order_added audit row includes actor_membership_id
4. no partial invalid settlement write occurs when blocked

This step is NOT feature development.
This step is NOT refactoring.
This step is NOT design work.

---

[STRICT RULES]

### 1. Runtime validation only
Use real HTTP/API execution only.

FAIL IF:
- validation is done only by static reading
- production logic is modified

---

### 2. No logic changes
Do NOT modify formulas, routes, or business rules.

FAIL IF:
- any file is changed
- any route behavior is redesigned

---

### 3. Safe test data only
Use only staging/test store/session data or clearly isolated validation data.

FAIL IF:
- real operating data is mutated without explicit safety boundary
- existing live business rows are corrupted

---

### 4. Required runtime scenarios

Must validate all of the following:

A. Settlement route negative remainder block
- create a case where pre_settlement_total > grossTotal
- call settlement create/recalc path
- confirm HTTP 409
- confirm error code = REMAINDER_NEGATIVE
- confirm no invalid receipt/settlement write occurred

B. Finalize route negative remainder block
- create a case where marginAmount < 0 before finalize
- call finalize path
- confirm HTTP 409
- confirm error code = REMAINDER_NEGATIVE
- confirm no finalize write occurred
- confirm no settlement_finalized audit row was written for blocked request

C. Order audit membership id
- create one safe order through the real orders API
- confirm order_added audit row exists
- confirm actor_membership_id is populated

---

### 5. Minimal scope
Do not test unrelated features in this step.

FAIL IF:
- account management is touched
- UI flows are tested
- printer work is included
- unrelated settlement scenarios are added

---

[VALIDATION METHOD]

For each scenario:

1. identify or create safe test fixture data
2. execute real API call
3. capture status code and response body
4. inspect resulting DB rows
5. verify expected write / no-write result
6. record pass or fail

---

[REQUIRED OUTPUT]

Respond with exactly:

1. TEST FIXTURES USED
2. RUNTIME SCENARIO RESULTS
3. NEGATIVE REMAINDER VERIFICATION
4. AUDIT ROW VERIFICATION
5. BLOCKED-WRITE VERIFICATION
6. FAILURES
7. FINAL GO / NO-GO

---

[STOP CONDITIONS]

STOP after runtime validation is complete.

DO NOT:
- modify code
- redesign routes
- add new scripts unless absolutely required only for safe test execution
- expand scope beyond the three required runtime checks

This step is RUNTIME VALIDATION ONLY.