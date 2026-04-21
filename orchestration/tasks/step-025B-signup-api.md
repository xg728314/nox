# STEP-025B — SIGNUP API IMPLEMENTATION

## OBJECTIVE

현재 `/signup` 페이지는 구현되어 있지만,
`/api/auth/signup` 는 아직 존재하지 않는다.

이번 라운드의 목적은
**승인형 hostess 회원가입을 위한 signup API를 최소 범위로 구현**하는 것이다.

즉:

- signup request 수신
- auth user 생성
- profile 생성 또는 업데이트
- pending membership 생성
- 운영자 승인 전까지 로그인 불가 상태 유지
- 현재 login / approvals 구조와 충돌 없이 연결

이번 라운드는 **backend API 구현만** 다룬다.

---

## LOCKED DESIGN

회원가입은 다음 입력을 받는다:

- store
- full_name
- nickname
- phone
- email
- password

회원가입 역할은 고정:

- `role = hostess`

승인 구조:

- signup request
- pending membership 생성
- 운영자 승인 후 login 가능

중요:
- owner / manager / counter signup 금지
- role picker 없음
- 공개 즉시 사용 구조 금지

---

## CURRENT CODE REALITY

이미 확인된 구조:

- `app/signup/page.tsx` 는 위 입력값으로 `/api/auth/signup` POST 준비 완료
- login은 `store_memberships.status='approved'` 인 경우만 허용
- approvals UI / approvals API 는 pending membership 소비자 역할
- schema에는 `profiles.full_name`, `profiles.nickname`, `profiles.phone` 존재
- `store_memberships.status` 기본 pending 지원
- signup producer route만 현재 없음

이번 작업은 이 빈 부분만 메우는 것이다.

---

## PRIMARY TASKS

### TASK 1 — route 생성

구현 대상:

- `C:\work\nox\app\api\auth\signup\route.ts`

POST only.

---

### TASK 2 — 입력 검증

request body에서 아래 입력을 받는다:

- store
- full_name
- nickname
- phone
- email
- password

검증 최소 요구:

- 전부 필수
- 문자열 trim 처리
- phone digits-only 정규화
- email 기본 형식 검증
- password 최소 길이 검증 (현재 signup page와 일관 수준)

주의:
- 과도한 validation 금지
- 프론트와 모순되지 않게 최소 수준 유지

---

### TASK 3 — store lookup

`store` 문자열로 실제 store row를 찾아야 한다.

반드시:
- 현재 실제 stores 테이블 기준 lookup
- 존재하지 않는 store면 400 반환
- 추측으로 store_uuid 만들지 말 것

---

### TASK 4 — duplicate safety check

최소한 아래 중복 상황 방지:

1. 같은 email
2. 같은 phone + 같은 store 기준에서 중복 pending/approved hostess 신청
   - 현재 schema 한계를 코드로 안전하게 보완할 것

주의:
- migration 추가 금지
- DB unique constraint 새로 만들지 말 것
- 애플리케이션 레벨 pre-check로 처리

반드시 결과를 명확한 message로 반환할 것.

---

### TASK 5 — auth user 생성

현재 프로젝트의 기존 auth 생성 방식/seed script/service role 사용 방식을 먼저 확인하고
그와 가장 일관된 방식으로 auth user를 생성할 것.

중요:
- Supabase auth user 생성은 service-role 기반이어야 할 가능성이 높음
- 현재 코드 기준 확인 후 구현
- 추측으로 anon client signUp 사용 금지 unless code evidence supports it

이 단계에서 실패 시 적절한 error 반환.

---

### TASK 6 — profile 생성 또는 업데이트

auth user 생성 후:

- profiles row 생성 또는 update
- `full_name`
- `nickname`
- `phone`

현재 schema/기존 code pattern 기준으로 가장 안전한 방식 사용.

---

### TASK 7 — pending membership 생성

`store_memberships` 에 아래 성격으로 row 생성:

- profile/user 연결
- target store 연결
- role = `hostess`
- status = `pending`
- is_primary = true
- approved_by = null
- approved_at = null

현재 schema 이름이 정확히 다르면 실제 컬럼 기준으로 맞출 것.

주의:
- role 추측 금지
- hostess 고정
- pending 고정

---

### TASK 8 — response shape

성공 시 응답은 “승인 대기” 의미가 분명해야 한다.

예시 방향:

```json
{
  "ok": true,
  "status": "pending",
  "message": "회원가입 신청이 접수되었습니다. 운영자 승인 후 로그인할 수 있습니다."
}