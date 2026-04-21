# STEP-NEXT — SETTLEMENT FORMULA REDEFINITION LOCK

[STEP ID]
STEP-NEXT-SETTLEMENT-FORMULA-LOCK

[TASK TYPE]
design lock (no implementation)

[OBJECTIVE]
Redefine and lock the settlement formula so that store revenue, manager/hostess flow, and customer payment are separated correctly according to confirmed business rules.

This step is required because the previous settlement formula treated participant time charges as store revenue, which is incorrect for the actual business model.

This step is NOT implementation.
This step is NOT UI work.
This step is formula / accounting definition lock only.

---

[CONFIRMED BUSINESS RULES]

Use ONLY the rules below.

### 1. Time charges are NOT store revenue

Customer-facing time prices exist:

- Public = 130,000
- Shirt = 140,000
- Hyper = 120,000

These amounts are charged to the customer, but they are NOT store revenue.

These amounts flow to:
- manager share
- hostess share

Manager takes approximately 0 ~ 10,000 per round.
Remaining amount goes to hostess.

Therefore:
- participant time charges MUST NOT be counted as store revenue
- participant time charges are pass-through settlement flow

---

### 2. Liquor deposit is store revenue

For liquor:

- store_revenue = deposit_price
- store_profit = deposit_price - bottle_cost
- manager_profit = sale_price - deposit_price
- hostess_profit_from_liquor = 0

Example:
- 3 bottles
- deposit_price = 130,000 each
- store_revenue = 390,000

Even if total customer payment is much larger, only the deposit-based amount is store revenue.

---

### 3. Customer total and store revenue are different

Customer may pay a large total amount.
That does NOT mean the store earned that total amount.

Need explicit separation between:
- customer total payment
- manager/hostess settlement flow
- store revenue
- store profit

---

### 4. Existing runtime rules remain valid

Do NOT change:
- lifecycle stages
- audit requirements
- negative remainder protection concept
- cross-store settlement model
- business-day close rules

Only redefine the accounting meaning of totals.

---

[SCOPE]

Define and lock:

1. settlement/accounting terms
2. formula boundaries
3. which values are store revenue vs pass-through
4. which values belong to manager / hostess / store
5. how receipts / settlement / closing should interpret totals
6. how old negative-margin drafts should be treated after formula redefinition

---

[STRICT RULES]

### 1. No guessing
Do NOT invent new money sources.

FAIL IF:
- any new revenue source is assumed without explicit basis

---

### 2. Participant flow is pass-through
Time charges must be treated as settlement flow, not store revenue.

FAIL IF:
- participant_total is still included in store revenue

---

### 3. Store revenue must be deposit-based
At minimum, store revenue includes liquor deposit totals.

FAIL IF:
- store revenue is still defined as participant_total + order_total

---

### 4. Manager / hostess flow must be separated
Manager and hostess settlement amounts must be treated as their own flow.

FAIL IF:
- manager/hostess flow is mixed into store margin calculation

---

### 5. Customer total may remain as reporting-only
Customer total payment may still exist, but must not be confused with store revenue.

FAIL IF:
- customer total is reused as store revenue

---

### 6. Existing data must be addressed
The design must explain how to treat already-created negative-margin draft receipts under the old formula.

Need explicit answer:
- recompute?
- invalidate?
- migrate?
- backfill?

FAIL IF:
- old draft treatment is omitted

---

[DESIGN QUESTIONS TO ANSWER]

The output MUST explicitly answer:

1. What is customer_total?
2. What is participant_flow_total?
3. What is manager_profit_total?
4. What is hostess_profit_total?
5. What is store_revenue_total?
6. What is store_profit_total?
7. Which values appear on receipt/customer-facing summary?
8. Which values drive store dashboard totals?
9. Which values drive closing report totals?
10. How should old negative-margin drafts be handled?

---

[REQUIRED OUTPUT FORMAT]

Respond with exactly:

1. ACCOUNTING TERM DEFINITIONS
2. FORMULA REDEFINITION
3. STORE REVENUE VS PASS-THROUGH RULES
4. RECEIPT / SETTLEMENT / CLOSING INTERPRETATION
5. OLD DRAFT TREATMENT PLAN
6. INVALID DEFINITIONS AFTER RELOCK
7. PASS / FAIL CRITERIA

---

[FORBIDDEN]

- code implementation
- schema migration
- UI changes
- dormant-system activation
- generic accounting advice not tied to confirmed business rules

---

[STOP CONDITIONS]

STOP after formula redefinition lock is complete.

This step is SETTLEMENT FORMULA REDEFINITION LOCK ONLY.