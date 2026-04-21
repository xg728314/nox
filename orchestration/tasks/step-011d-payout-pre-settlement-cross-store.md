# STEP-011D — PAYOUT / PRE-SETTLEMENT / CROSS-STORE SETTLEMENT

## OBJECTIVE

Implement the payout layer on top of the already-completed settlement calculation and lock system.

This step must support:

1. payout tracking
2. partial payout (선정산)
3. cross-store settlement grouped by store
4. manager-level partial payout inside a store-level cross-store settlement

Do NOT change confirmed business formulas.
Do NOT change settlement calculation logic.
Do NOT change settlement status rules from STEP-011C.

---

## CONFIRMED BUSINESS RULES (LOCKED INPUT)

### Cross-store settlement

Default grouping is store-level.

Example:
- Bali store total owed = 1,200,000 KRW

Inside that total, manager-level allocation may exist:

- Manager A = 400,000
- Manager B = 400,000
- Manager C = 400,000

A specific manager may request early payout first.

Example:
- Manager A is pre-paid 400,000
- Then Bali store remaining amount becomes 800,000

This means:

- outer settlement unit = target store
- inner allocation unit = target manager
- payout can happen partially at manager level
- remaining store total must decrease accordingly

---

## CURRENT COMPLETED FOUNDATION

Already done:

- settlement generation
- normalized share storage
- confirm / paid lock
- manager/store/hostess money separated structurally

This step adds payout tracking.
This step must NOT recalculate business math.

---

## REQUIRED DATA MODEL

### 1. payout_records

Track every actual payout event.

Fields:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- settlement_id uuid null
- settlement_item_id uuid null
- target_store_uuid uuid null
- target_manager_membership_id uuid null
- amount numeric not null default 0
- payout_type text not null
- status text not null default 'completed'
- account_id uuid null
- payee_account_id uuid null
- note text null
- paid_at timestamptz not null default now()
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- store_uuid
- settlement_id
- settlement_item_id
- target_store_uuid
- target_manager_membership_id

Purpose:
- record real money movement
- support full payout or partial payout
- support store-level and manager-level payout

### 2. cross_store_settlements

Header table for store-level external settlement.

Fields:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- target_store_uuid uuid not null
- total_amount numeric not null default 0
- prepaid_amount numeric not null default 0
- remaining_amount numeric not null default 0
- status text not null default 'open'
- note text null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- store_uuid
- target_store_uuid

### 3. cross_store_settlement_items

Manager-level allocation inside a target store.

Fields:

- id uuid primary key default gen_random_uuid()
- cross_store_settlement_id uuid not null
- store_uuid uuid not null
- target_store_uuid uuid not null
- target_manager_membership_id uuid null
- assigned_amount numeric not null default 0
- prepaid_amount numeric not null default 0
- remaining_amount numeric not null default 0
- status text not null default 'open'
- note text null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- cross_store_settlement_id
- store_uuid
- target_store_uuid
- target_manager_membership_id

Purpose:
- allow store-level settlement header
- allow manager-level split
- allow manager-level partial payout
- reduce store remaining amount when item prepaid

---

## STATUS RULES

### payout_records.status
Allowed:
- completed

No complex reversal flow in this step.

### cross_store_settlements.status
Allowed:
- open
- partial
- completed

### cross_store_settlement_items.status
Allowed:
- open
- partial
- completed

Rules:
- prepaid_amount must never exceed assigned_amount
- remaining_amount = assigned_amount - prepaid_amount
- header.prepaid_amount = sum(item.prepaid_amount)
- header.remaining_amount = total_amount - prepaid_amount

---

## API CHANGES

### 1. POST /api/sessions/[session_id]/settlement/payout

Purpose:
- record payout against a settlement or settlement item

Input:
- settlement_item_id (optional)
- amount
- account_id (optional)
- payee_account_id (optional)
- note (optional)

Rules:
- same-store only
- settlement must exist
- settlement must be confirmed or paid
- amount > 0
- if settlement_item_id is given, it must belong to the settlement
- create payout_records row
- do NOT recalculate settlement
- do NOT change business shares

This route records payout only.
If a full "paid" state transition is needed, that still belongs to the existing /settlement/pay route.

---

### 2. POST /api/cross-store-settlements

Purpose:
- create store-level cross-store settlement header + manager allocations

Input:
- target_store_uuid
- total_amount
- items: [{ target_manager_membership_id, assigned_amount, note? }]

Rules:
- grouped by target store
- total_amount must equal sum(items.assigned_amount) if items are provided
- if no manager items provided, allow pure store-level open header
- initial:
  - prepaid_amount = 0
  - remaining_amount = total_amount
  - status = open

---

### 3. GET /api/cross-store-settlements/[id]

Return:
- header
- manager-level items
- computed totals

---

### 4. POST /api/cross-store-settlements/[id]/prepay

Purpose:
- apply partial payout to a manager allocation

Input:
- item_id
- amount
- account_id (optional)
- payee_account_id (optional)
- note (optional)

Rules:
- amount > 0
- item must belong to the header
- prepaid_amount += amount
- remaining_amount -= amount
- item prepaid_amount must not exceed assigned_amount
- header prepaid_amount / remaining_amount / status must be recomputed from all live items
- create payout_records row with payout_type='cross_store_prepay'
- if item.remaining_amount = 0 → item.status = completed
- else item.status = partial
- if header.remaining_amount = 0 → header.status = completed
- else if header.prepaid_amount > 0 → header.status = partial
- else header.status = open

---

## SETTLEMENT / PAYOUT RELATION

Important distinction:

- settlement confirm/pay status = accounting lock lifecycle
- payout_records = actual money transfer log

Do NOT merge these concepts.
A settlement may be confirmed before all payouts are fully recorded.
A cross-store settlement may be partially paid while still open.

---

## SECURITY RULES

Mandatory:
- resolveAuthContext on every route
- store_uuid on every query
- no trusting request store_uuid
- cross-store records can only be created/read/updated from the caller's own store scope

Forbidden:
- paying another store's records without same-store authority
- editing another store's header/items
- overpaying manager allocation
- negative amount
- hard delete

---

## AUDIT REQUIREMENT

Record audit_events for:

- settlement_payout_recorded
- cross_store_settlement_created
- cross_store_prepay_recorded

Payload must include:
- relevant ids
- amount
- previous totals/status
- new totals/status
- actor_membership_id
- store_uuid

Use existing audit_events pattern.
Do not invent a parallel audit system.

---

## MIGRATION

Create a new migration, recommended:

- database/035_payout_and_cross_store_settlements.sql

Additive only.
No drop-column work.

---

## VALIDATION

Must verify:

1. confirmed settlement can record payout
2. payout record does not alter business calculation fields
3. cross-store header can be created at store level
4. manager allocation items can be created
5. manager prepay reduces item remaining amount
6. manager prepay reduces header remaining amount
7. overpay is blocked
8. status open → partial → completed works
9. payout audit events are inserted
10. cross-store audit events are inserted
11. npx tsc --noEmit passes

---

## FAIL IF

- payout changes settlement math
- overpay allowed
- header remaining amount not synced with item prepay
- store-level grouping broken
- manager-level prepay missing
- audit missing
- hard delete used
- store_uuid scope missing

---

## OUTPUT FORMAT

Return only final report:

1. FILES CHANGED
2. DB CHANGES
3. API CHANGES
4. PAYOUT / PREPAY FLOW
5. AUDIT CHANGES
6. VALIDATION RESULT
7. KNOWN LIMITS