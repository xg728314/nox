# STEP-010 — MY INFO FEATURE

## OBJECTIVE

내 정보 / 계좌 / 지급 대상 관리 기능 구현

---

## MENU

- 내 정보 (/me) 추가

---

## PAGE

app/me/page.tsx

Tabs:
- 기본 정보
- 월 정산
- 내 계좌
- 지급 대상 계좌

---

## DATABASE

### settlement_accounts

- owner_membership_id
- bank_name
- account_number
- account_type
- is_default
- is_active

---

### payee_accounts

- payee_name
- linked_membership_id (optional)
- account_number

---

## API

/accounts CRUD
/payees CRUD

---

## RULES

- store_uuid 필수
- membership_id 기반
- default 계좌 1개만

---

## FORBIDDEN

- profiles에 계좌 저장 금지
- component에서 fetch 금지

---

## VALIDATION

- tsc 통과
- 기존 기능 영향 없음