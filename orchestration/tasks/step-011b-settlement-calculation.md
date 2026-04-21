# STEP-011B — SETTLEMENT CALCULATION

## OBJECTIVE

Implement actual settlement calculation logic based ONLY on confirmed business rules.

NO assumptions allowed.  
NO inferred formulas.

---

## CONFIRMED RULES (LOCKED INPUT)

### Liquor (양주)

- manager_profit = sale_price - deposit_price
- hostess_profit_from_liquor = 0
- store_revenue = deposit_price
- store_profit = deposit_price - bottle_cost

### Hostess earnings

- hostess earns based on time worked in room
- NOT from liquor margin

Time pricing:

- Public: 90min = 130,000 / half = 70,000
- Shirt: 60min = 140,000 / half = 70,000
- Hyper: 60min = 120,000 / half = 60,000

Cha3:

- 9~15 min
- default = 30,000
- Shirt exception:
  - greeting → NOT cha3 → treated as half-time (70,000)
  - else → cha3

### Deduction

- deduction belongs to manager
- per-hostess configurable
- deduction types:
  - 1타임
  - 반타임
  - 차3

### Cross-store

- grouped by store
- manager-level split exists
- partial pre-settlement allowed

### Session correction

- time can be changed (e.g. 3 → 2.5)
- affects settlement
- allowed before final confirmation

---

## IMPLEMENTATION SCOPE

You must implement:

1. participant-level earnings calculation
2. session-level totals update
3. settlement generation uses calculated values

Do NOT implement UI.  
Do NOT implement payment flow.

---

## DATA FLOW

orders → session → participants → settlement

---

## REQUIRED CHANGES

### 1. Extend participant calculation logic

For each `session_participant`:

#### A. Hostess earnings

Compute:

- `base_time_amount`
- `half_time_amount`
- `cha3_amount`

Use actual session data only:

- time segments
- type
- greeting flag (if present)

Result:

```ts
hostess_base_amount
B. Deduction

Apply per-hostess config:

deduction_amount =
  (time_units * per_time_deduction) +
  (half_units * half_deduction) +
  (cha3_units * cha3_deduction)
C. Final hostess earning
hostess_final = hostess_base_amount - deduction_amount
D. Manager earning
manager_from_liquor = sum(liquor_margin)
manager_from_deduction = deduction_amount

manager_total = manager_from_liquor + manager_from_deduction
E. Store values
store_revenue = sum(deposit_price)
store_profit = deposit_price - bottle_cost
2. Persist into session_participants

Update fields:

hostess_share_amount
manager_share_amount
store_share_amount

No NULL after calculation.

3. Settlement generation uses these fields

Do NOT recompute inside settlement route.

Settlement must only read:

session_participants.manager_share_amount
session_participants.hostess_share_amount
session_participants.store_share_amount
RULES
MUST use stored values only
MUST NOT compute settlement directly from orders
MUST NOT guess missing data
MUST respect store_uuid
VALIDATION

Must verify:

hostess earnings correct per type
deduction applied correctly
manager receives:
liquor margin
deduction
store revenue correct
session correction recalculates values
settlement uses stored values only
FAIL IF
any formula is invented
deduction applied to wrong entity
hostess gets liquor margin
store revenue ≠ deposit price
calculation done inside settlement route
OUTPUT FORMAT

Return only:

FILES CHANGED
CALCULATION LOGIC
DATA FLOW
VALIDATION RESULT
KNOWN LIMITS