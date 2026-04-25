# NOX RLS 1차 적용 — READ 정책만

## OBJECTIVE
NOX 코드베이스에 store_uuid 기반 Row Level Security 를 1차 적용한다.

이번 라운드 목표는 **SELECT(READ) 보호만 적용**하는 것이다.
기존 API 동작을 깨지 않고, DB 레벨에서 same-store read 만 허용하도록 만든다.

---

## STRICT RULES

- 추측 금지
- 실제 schema / 실제 route / 실제 query 기준으로만 작업
- 이번 라운드에서는 **WRITE 정책 금지**
- 기존 API 응답 shape 변경 금지
- 기존 비즈니스 로직 변경 금지
- 기존 route layer 권한 체크 제거 금지
- 이번 라운드는 **RLS 추가 + request context 주입 지점 탐색/준비 + 검증**까지만
- 한 번에 전체 테이블 적용 금지
- 지정한 테이블 외 확장 금지

---

## TARGET TABLES

아래 테이블만 대상으로 한다.

1. rooms
2. sessions
3. session_participants
4. hostesses
5. store_memberships
6. staff_work_logs

---

## TASK 1 — 실제 schema 확인

반드시 실제 DB schema 파일 기준으로 아래를 확인해라.

- 각 테이블의 실제 PK
- 각 테이블의 `store_uuid` 존재 여부
- `staff_work_logs` 처럼 `store_uuid` 단일 컬럼이 없을 가능성 확인
- soft-delete 컬럼(`deleted_at`) 존재 여부
- 이미 RLS / policy 가 있는지 여부

확인 결과를 먼저 보고해라.

중요:
- `store_uuid` 가 없는 테이블에 억지 policy 작성 금지
- 그런 경우는 "이번 라운드 적용 제외"로 분리 보고

---

## TASK 2 — SELECT RLS 정책 SQL 작성

원칙:

- 기본 정책은 same-store read only
- `current_setting('app.store_uuid', true)` 사용
- setting 이 없으면 NULL 이어야 하며, 그 경우 row 접근 불가가 되게 구성
- policy 이름은 충돌 없고 의미 분명하게 작성

기본 형태:

```sql
USING (
  store_uuid = current_setting('app.store_uuid', true)::uuid
)