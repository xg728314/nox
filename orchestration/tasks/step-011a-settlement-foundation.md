# STEP-011A — SETTLEMENT FOUNDATION

## OBJECTIVE

정산의 기반 구조를 만든다.

이번 단계에서는:
- participant 기준 수익 필드 확장
- settlements / settlement_items 기본 테이블 추가
- 세션 종료 후 정산 생성 가능한 최소 구조 확보

이번 단계에서는 하지 말 것:
- 최종 정산 UI 완성
- 복잡한 분배 규칙 전체 구현
- 자동 송금
- 회계/리포트 완성

---

## SCOPE

Implement foundation only:

1. DB schema for settlement base
2. Minimal server-side settlement creation flow
3. Participant-based settlement item structure
4. Status/locking foundation

Do NOT break existing counter / chat / credit flows.

---

## DB CHANGES

### 1. extend session_participants

Add nullable numeric fields:

- price_amount
- manager_share_amount
- hostess_share_amount
- store_share_amount
- share_type

Purpose:
- participant-level earning attribution
- future settlement generation source

Notes:
- nullable allowed for now
- existing rows must remain valid

---

### 2. create settlements

Fields:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- session_id uuid not null
- status text not null default 'draft'
- total_amount numeric not null default 0
- manager_amount numeric not null default 0
- hostess_amount numeric not null default 0
- store_amount numeric not null default 0
- confirmed_at timestamptz null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- store_uuid
- session_id
- unique(session_id) where deleted_at is null

---

### 3. create settlement_items

Fields:

- id uuid primary key default gen_random_uuid()
- settlement_id uuid not null
- store_uuid uuid not null
- participant_id uuid null
- membership_id uuid null
- role_type text not null
- amount numeric not null default 0
- account_id uuid null
- payee_account_id uuid null
- note text null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- deleted_at timestamptz null

Indexes:
- settlement_id
- store_uuid
- participant_id
- membership_id

Purpose:
- detailed payout / earning lines
- later account binding

---

## STATUS RULES

Allowed settlement statuses:

- draft
- confirmed
- paid

Rules:
- new settlements start as draft
- confirmed means locked
- paid means payout completed
- confirmed / paid are immutable in this step
- only draft can be rebuilt

---

## API DESIGN

### 1. POST /api/sessions/[session_id]/settlement

Purpose:
- create or rebuild draft settlement for a closed session

Rules:
- require resolveAuthContext
- require store_uuid scope
- session must belong to same store
- session must be checkout/closed eligible
- if confirmed or paid settlement exists → reject
- if draft exists → rebuild allowed
- no cross-store access

Expected output:
- settlement summary
- generated item count
- totals

### 2. GET /api/sessions/[session_id]/settlement

Purpose:
- fetch settlement summary for a session

Return:
- settlement header
- settlement items
- participant-based totals

---

## SETTLEMENT GENERATION LOGIC

Minimal implementation for this step:

### total_amount
- sum of orders.amount for the session
- use same-store scoped query only

### participant-derived totals
- use session_participants share fields if present
- if null, treat as 0

### settlement_items generation
Create rows from participant data:

- if manager_share_amount > 0
  - create manager role item
- if hostess_share_amount > 0
  - create hostess role item
- if store_share_amount > 0
  - create store role item optional
  - store line may be deferred if product shape is not ready

Use membership_id / participant_id when available.
No speculative split logic.
Do not invent business math not present in stored fields.

---

## IMMUTABILITY RULES

- confirmed settlement cannot be rebuilt
- paid settlement cannot be rebuilt
- only draft can be replaced
- do not hard delete historical confirmed/paid rows

For draft rebuild:
- soft delete old settlement_items or replace safely
- keep implementation simple and deterministic

---

## UI SCOPE

Do NOT build full settlement page in this step.

Allowed:
- existing APIs only
- optional minimal debug response output

Not allowed:
- new big UI flow
- changing counter UX
- changing chat UX

---

## SECURITY RULES

Mandatory:
- resolveAuthContext on every route
- store_uuid on every query
- no trusting client-sent membership_id/store_uuid
- no cross-store settlement access

Forbidden:
- create settlement for another store's session
- rebuild confirmed settlement
- rebuild paid settlement
- deriving payouts from UI-only values

---

## MIGRATION

Create a new migration file.

Recommended:
- database/032_settlement_foundation.sql

Use additive changes only.
Do not modify unrelated schema.

---

## VALIDATION

Must verify:

1. migration applies cleanly
2. old data remains valid
3. POST settlement on eligible session creates draft
4. GET settlement returns header + items
5. draft rebuild works
6. confirmed settlement rebuild is blocked
7. cross-store session blocked
8. npx tsc --noEmit passes

---

## FAIL IF

- existing chat routes break
- existing counter routes break
- settlement creation ignores store_uuid
- confirmed settlement can be rebuilt
- speculative revenue split logic added beyond stored fields
- UI logic used as source of truth

---

## OUTPUT FORMAT

Return only final report:

1. FILES CHANGED
2. DB CHANGES
3. API CHANGES
4. GENERATION LOGIC
5. VALIDATION RESULT
6. KNOWN LIMITS