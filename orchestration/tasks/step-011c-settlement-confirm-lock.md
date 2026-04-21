# STEP-011C — SETTLEMENT CONFIRM / LOCK

## OBJECTIVE

Implement settlement status transition and locking rules.

This step must make settlement state authoritative:

- draft
- confirmed
- paid

Once confirmed, recalculation and rebuild must be blocked.
Once paid, payout is considered completed.

Do NOT implement full payment UI in this step.
Do NOT change business formulas.

---

## CURRENT STATE

Already completed:

- settlement foundation
- settlement generation
- normalized share storage
- recalculation route
- manager/store/hostess totals separated correctly

Now the missing piece is status control and immutability.

---

## REQUIRED RULES

### Statuses

Allowed statuses:

- draft
- confirmed
- paid

### Transition rules

Allowed:

- draft → confirmed
- confirmed → paid

Not allowed:

- confirmed → draft
- paid → draft
- paid → confirmed (unless explicitly supported later; for now block)
- direct overwrite to unknown status

### Locking rules

When settlement is confirmed:

- settlement recalculation must be blocked
- settlement rebuild must be blocked
- participant share recalculation must be blocked

When settlement is paid:

- same locks remain
- considered payout-complete state

---

## API CHANGES

### 1. POST /api/sessions/[session_id]/settlement/confirm

Purpose:
- confirm a draft settlement

Behavior:
- require resolveAuthContext
- require same-store session
- require live settlement exists
- require settlement.status === 'draft'
- update settlement.status = 'confirmed'
- set confirmed_at = now()
- set updated_at = now()

Response:
- settlement_id
- session_id
- status
- confirmed_at

### 2. POST /api/sessions/[session_id]/settlement/pay

Purpose:
- mark a confirmed settlement as paid

Behavior:
- require resolveAuthContext
- require same-store session
- require live settlement exists
- require settlement.status === 'confirmed'
- update settlement.status = 'paid'
- set updated_at = now()

Response:
- settlement_id
- session_id
- status

---

## AUDIT REQUIREMENT

Add audit records for both actions.

Recommended event types:

- settlement_confirmed
- settlement_paid

Payload must include at minimum:

- settlement_id
- session_id
- previous_status
- new_status
- actor_membership_id
- store_uuid

Use existing audit pattern if available.
Do not invent a new unrelated audit system.

---

## ROUTE GUARDS TO UPDATE

Existing routes that must respect lock state:

### 1. POST /api/sessions/[session_id]/settlement
- already blocks confirmed / paid rebuild
- verify still correct after confirm/pay implementation

### 2. POST /api/sessions/[session_id]/settlement/recalculate
- already blocks confirmed / paid recalculation
- verify still correct

If any route only partially checks lock state, harden it.

---

## GET ROUTE EXPECTATION

GET /api/sessions/[session_id]/settlement must now expose status clearly.

Required:
- settlement.status
- settlement.confirmed_at

No UI work required here, but response must remain usable.

---

## SECURITY RULES

Mandatory:

- store_uuid scope on every query
- resolveAuthContext on every route
- no client-trusted store/session ownership
- cross-store access blocked

Forbidden:

- confirm another store's settlement
- pay another store's settlement
- confirm nonexistent settlement
- pay draftless settlement
- bypass confirmed/paid lock

---

## DB CHANGES

Only if needed.

Preferred:
- no schema change unless audit linkage needs one
- use existing settlements.status and confirmed_at fields

If absolutely needed, add a minimal migration only.

---

## VALIDATION

Must verify:

1. draft settlement can be confirmed
2. confirmed settlement cannot be rebuilt
3. confirmed settlement cannot be recalculated
4. confirmed settlement can be marked paid
5. paid settlement cannot be rebuilt
6. paid settlement cannot be recalculated
7. audit event recorded on confirm
8. audit event recorded on paid
9. cross-store confirm/pay blocked
10. npx tsc --noEmit passes

---

## FAIL IF

- confirmed settlement can still recalculate
- paid settlement can still rebuild
- status transition order is invalid
- audit missing
- store_uuid scope missing
- business formulas changed
- normalized share structure broken

---

## OUTPUT FORMAT

Return only final report:

1. FILES CHANGED
2. API CHANGES
3. STATUS / LOCK RULES
4. AUDIT CHANGES
5. VALIDATION RESULT
6. KNOWN LIMITS