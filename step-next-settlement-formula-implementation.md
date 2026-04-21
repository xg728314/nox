# STEP-NEXT — SETTLEMENT FORMULA IMPLEMENTATION

[STEP ID]
STEP-NEXT-SETTLEMENT-FORMULA-IMPLEMENTATION

[TASK TYPE]
controlled implementation

[OBJECTIVE]
Implement the locked settlement formula redefinition in the live settlement path.

This step must update the production settlement flow so that:
- participant time charges are treated as pass-through flow
- store revenue is deposit-based
- store profit is deposit minus bottle cost
- customer total remains separate from store revenue

This step is implementation.
This step is NOT a design-only task.
This step is NOT a dormant-system task.

Use only the live System A path.

---

[LOCK REFERENCE]

This implementation MUST follow:

- STEP-NEXT-SETTLEMENT-FORMULA-LOCK

Do NOT deviate from that lock.

---

[LIVE PATH ONLY]

Use System A only:

- app/api/sessions/settlement/route.ts
- app/api/sessions/settlement/finalize/route.ts
- receipts / receipt_snapshots / pre_settlements
- existing live-path UI/API consumers

DO NOT activate or migrate to System B.

FAIL IF:
- dormant normalized settlement infrastructure is used
- [session_id]/settlement/recalculate path becomes the live calculator

---

[STRICT RULES]

### 1. No business-rule deviation
Do NOT change the locked business rules.

FAIL IF:
- participant time charges are still treated as store revenue
- store revenue is still computed as participant_total + order_total

---

### 2. Minimal live-path scope
Touch only files required to implement the new formula in the live path.

Expected primary targets:
- app/api/sessions/settlement/route.ts
- app/api/sessions/settlement/finalize/route.ts

Possible secondary targets only if strictly required for compatibility:
- app/api/sessions/receipt/route.ts
- owner/store settlement summary readers
- minimal shared types/helpers

FAIL IF:
- dormant settlement system is modified
- unrelated UI/features are changed broadly

---

### 3. Preserve lifecycle and guards
Do NOT change:
- auth rules
- store_uuid scope
- finalize lifecycle gates
- business-day close rules
- audit requirements
- negative-remainder protection concept

Only retarget the meaning of totals and the guard invariant.

FAIL IF:
- lifecycle semantics change
- finalize becomes a calculator again

---

### 4. Separate customer / pass-through / store totals
Implementation must explicitly separate:
- customer_total
- participant_flow_total
- manager_profit_total
- hostess_profit_total
- store_revenue_total
- store_profit_total

FAIL IF:
- these are collapsed back into one gross/margin concept

---

### 5. Old drafts must be handled
The implementation must include a clear backfill-compatible path for old draft receipts created under the old formula.

This step does NOT need to run the full backfill automatically unless clearly safe, but it must make recomputation possible and define the write shape.

FAIL IF:
- old negative-margin drafts remain unaddressable
- implementation blocks future recompute

---

[IMPLEMENTATION REQUIREMENTS]

### A. settlement/route.ts must compute new totals

Must compute and persist at minimum:

- customer_total
- participant_flow_total
- manager_profit_total
- hostess_profit_total
- store_revenue_total
- store_profit_total

Mapping from locked rules:

- customer_total
  = participant time charges
  + liquor sale total
  + waiter tip
  + card fee passthrough if already modeled

- participant_flow_total
  = sum of participant price_amount

- manager_profit_total
  = participant manager payouts
  + liquor manager margin (sale_price - store_price)

- hostess_profit_total
  = participant hostess payouts

- store_revenue_total
  = liquor deposit total
  + store-kept waiter tip if already modeled

- store_profit_total
  = store_revenue_total - bottle_cost total

### B. legacy gross/margin fields
If existing receipts schema still uses fields like:
- gross_total
- margin_amount
- participant_total_amount
- order_total_amount

implementation must either:
- repurpose them consistently for backward compatibility, OR
- maintain them as legacy fields while writing the new authoritative values into snapshot/compatible fields

But:
- owner/store logic must no longer treat legacy gross as store revenue
- margin_amount must no longer be based on gross - tc - labor

### C. negative guard retarget
The negative guard must no longer compare store margin against labor flow.

It must protect the new invariant:
- manager + hostess participant labor split must not exceed participant_flow_total
- other locked invalid states must still be blocked

### D. finalize route
Finalize must remain read-only for money values.
If snapshot fields change, finalize may read and lock the new stored fields, but it must not recalculate.

### E. audit
Audit payloads must reflect the new totals clearly enough to reconstruct:
- customer_total
- participant_flow_total
- manager_profit_total
- hostess_profit_total
- store_revenue_total
- store_profit_total

### F. compatibility
Existing API consumers should continue to work where possible.
If response shapes must change, keep changes minimal and explain them clearly.

---

[OLD DRAFT TREATMENT]

Implement with backfill compatibility in mind:

- old draft receipts must be recomputable from source rows
- no deletion of historical session rows
- no schema migration unless absolutely required and directly justified
- finalized receipts remain immutable

If a one-off recompute script is needed, note that as a follow-up unless it is already required in this step.

---

[REQUIRED VERIFICATION]

Must run:

1. npx tsc --noEmit
2. npm run build

Must also verify statically or functionally:

- participant flow no longer counted as store revenue
- store revenue is deposit-based
- store profit is deposit - bottle_cost based
- finalize is not recalculating
- new invariant guard is present
- old draft receipts are recomputable in principle

---

[OUTPUT FORMAT]

Respond with exactly:

1. FILES CHANGED
2. FORMULA IMPLEMENTATION SUMMARY
3. NEW TOTAL DEFINITIONS IN CODE
4. FINALIZE / SNAPSHOT BEHAVIOR
5. VALIDATION
6. OLD DRAFT HANDLING
7. RISKS / FOLLOW-UPS

---

[STOP CONDITIONS]

STOP after implementation and verification are complete.

DO NOT:
- activate System B
- redesign UI broadly
- rewrite unrelated modules
- perform a broad schema rewrite unless absolutely required

This step is SETTLEMENT FORMULA IMPLEMENTATION ONLY.