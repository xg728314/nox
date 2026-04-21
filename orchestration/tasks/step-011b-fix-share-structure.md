# STEP-011B-FIX — SHARE STRUCTURE NORMALIZATION

## OBJECTIVE

Remove the temporary anchor-row share concentration design.

Current calculation formulas are acceptable, but the persistence shape is wrong for production because session-level manager/store values are being forced onto a single hostess participant row.

This fix must normalize storage so that:

- hostess earnings stay on participant rows
- manager earnings are stored separately
- store share/profit is stored separately

NO assumptions allowed.
Do NOT change confirmed business formulas.
Change storage shape only.

---

## CURRENT PROBLEM

The current implementation writes:

- hostess_share_amount
- manager_share_amount
- store_share_amount

into `session_participants`.

This causes a session-level manager/store amount to be concentrated on one "anchor" hostess row.

That is NOT acceptable for production because:

- manager money is not hostess money
- store money is not hostess money
- per-row settlement / payout / account-binding becomes structurally wrong
- anchor row can change after recalculation

The sums may be correct, but the ownership model is wrong.

---

## REQUIRED TARGET SHAPE

### 1. session_participants

Keep ONLY hostess-attributable values here.

Allowed on participant row:
- hostess_share_amount
- share_type

Manager/store totals must NOT depend on a hostess anchor row.

If `manager_share_amount` / `store_share_amount` columns already exist, they may remain in schema for backward compatibility, but they must no longer be the authoritative storage for session-level manager/store money.

---

### 2. New table: session_manager_shares

Create a dedicated table for manager earnings.

Fields:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- session_id uuid not null
- manager_membership_id uuid not null
- amount numeric not null default 0
- source_type text not null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- store_uuid
- session_id
- manager_membership_id

Purpose:
- store manager-level money separately from hostess rows
- allow one or more manager rows per session
- source_type may distinguish:
  - liquor_margin
  - deduction
  - combined
Choose the simplest shape that matches the actual confirmed data without inventing extra logic.

---

### 3. New table: session_store_shares

Create a dedicated table for store-level amount.

Fields:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- session_id uuid not null
- amount numeric not null default 0
- source_type text not null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- store_uuid
- session_id

Purpose:
- store session-level store amount separately
- no dependence on participant row

---

## BUSINESS RULES (LOCKED — DO NOT CHANGE)

### Liquor
- manager_profit = sale_price - deposit_price
- hostess_profit_from_liquor = 0
- store_revenue = deposit_price
- store_profit = deposit_price - bottle_cost

### Hostess
- hostess earns from work/time in room
- hostess deduction money belongs to manager

### Deduction
- per-hostess configurable
- deduction reduces hostess final amount
- deduction increases manager amount

### Session correction
- recalculation allowed before final confirmation

DO NOT change any formula already implemented unless required to remove anchor persistence.

---

## IMPLEMENTATION REQUIREMENTS

### 1. Migration

Create a new migration, recommended name:

- database/034_session_share_normalization.sql

Add:

- session_manager_shares
- session_store_shares

Additive only.
Do not drop existing columns in this step.

---

### 2. Calculation writer refactor

Refactor:

- lib/settlement/computeSessionShares.ts
- any related route writer

Required behavior:

#### Hostess rows
For each hostess participant row:
- compute hostess_final
- persist hostess_share_amount
- persist share_type
- do NOT persist session-level liquor/store totals onto one hostess row

#### Manager rows
Persist manager earnings into `session_manager_shares`.

At minimum, the persisted total across manager rows must equal:

- liquor_margin total
- plus deduction total

If only one responsible manager can currently be identified from confirmed stored data, write one row for that manager.
If the current schema does not support multi-manager attribution without guessing, do NOT invent splits.

#### Store row
Persist session store amount into `session_store_shares`.

At minimum, amount must equal:
- store_profit

Do NOT force this onto hostess participant rows.

---

### 3. Recalculate route behavior

Refactor recalculate route so it rewrites:

- participant hostess values
- session_manager_shares rows
- session_store_shares rows

Rules:
- old live rows for this session should be soft-deleted or replaced safely
- no hard delete
- idempotent behavior required
- confirmed / paid settlement must still block recalculation
- active session must still block recalculation

---

### 4. Settlement route compatibility

Current settlement routes from STEP-011A read only:

- session_participants.manager_share_amount
- session_participants.hostess_share_amount
- session_participants.store_share_amount

This is no longer acceptable once normalization is complete.

You must update settlement generation so that it reads from authoritative sources:

- hostess totals from session_participants.hostess_share_amount
- manager totals from session_manager_shares
- store totals from session_store_shares

Settlement generation must NOT depend on anchor row logic anymore.

Important:
- Do not recompute business formulas inside settlement generation
- settlement generation must only aggregate stored share rows

---

## DATA MODEL RULES

### Authoritative ownership
- hostess money → participant row
- manager money → manager share table
- store money → store share table

### Forbidden
- putting manager session total onto hostess row
- putting store session total onto hostess row
- any proportional split without confirmed rule
- any synthetic anchor participant

---

## VALIDATION

Must verify:

1. recalculation no longer produces anchor concentration
2. hostess participant rows contain only hostess-attributable values
3. session_manager_shares total equals manager total
4. session_store_shares total equals store total
5. settlement generation reads normalized sources only
6. confirmed / paid settlement blocks recalculation
7. active session blocks recalculation
8. npx tsc --noEmit passes

---

## FAIL IF

- anchor row logic still exists
- settlement still depends on participant manager/store fields as source of truth
- manager/store totals are written onto hostess rows
- any new split logic is invented
- cross-store scope is missing
- hard delete is used

---

## OUTPUT FORMAT

Return only final report:

1. FILES CHANGED
2. DB CHANGES
3. STORAGE SHAPE CHANGES
4. SETTLEMENT AGGREGATION CHANGES
5. VALIDATION RESULT
6. KNOWN LIMITS