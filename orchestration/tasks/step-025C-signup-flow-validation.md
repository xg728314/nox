 # STEP-025C — SIGNUP FLOW VALIDATION

## OBJECTIVE

현재 NOX에는 다음 흐름이 구현되었거나 구현 직후 상태다:

- `/signup` 페이지
- `/api/auth/signup`
- approvals consumer
- approved-only login gate

이번 라운드의 목적은
**회원가입 → pending → 승인 → 로그인 허용**
전체 흐름이 실제로 정상 동작하는지 검증하는 것이다.

이 라운드는 기능 추가가 아니라 **실전 플로우 검증**이 핵심이다.

즉:

1. signup 요청이 실제로 들어가는지
2. pending membership 이 생성되는지
3. approvals 화면/API에서 그 신청이 보이는지
4. approve 후 상태가 바뀌는지
5. 승인 전 로그인은 막히는지
6. 승인 후 로그인은 되는지

를 확인해야 한다.

---

## CURRENT ASSUMPTIONS TO VERIFY

반드시 실제 코드/실행 기준으로 확인할 것:

- signup page는 존재한다
- signup API는 존재한다
- approvals 화면/route는 pending membership을 소비한다
- login은 approved membership만 허용한다

주의:
- 이 라운드에서 가정하지 말고 실제로 검증할 것
- 추측 금지

---

## PRIMARY VALIDATION FLOW

### STEP 1 — signup 요청 검증

`/signup` 에서 실제 신규 신청을 생성한다.

입력값 예시:
- store: 마블 / 버닝 / 황진이 / 라이브 중 하나
- full_name
- nickname
- phone
- email
- password

검증할 것:
- 성공 응답이 오는지
- success/pending 메시지가 맞는지
- auth user 생성 여부
- profile row 생성/업데이트 여부
- membership row 생성 여부

---

### STEP 2 — pending 상태 검증

signup 직후 다음을 확인:

- `store_memberships.status = pending`
- `role = hostess`
- 대상 store가 맞는지
- `approved_by`, `approved_at` 가 비어있는지
- `full_name`, `nickname`, `phone` 값이 저장되었는지

---

### STEP 3 — 승인 전 로그인 차단 검증

방금 가입한 계정으로
승인 전에 로그인 시도한다.

검증할 것:
- 로그인 차단되는지
- 응답 에러가 현재 정책과 맞는지
- 승인 대기 메시지가 합리적인지

중요:
- approved-only login gate가 깨지면 FAIL

---

### STEP 4 — approvals 표시 검증

owner 또는 manager 권한으로 approvals 흐름을 확인한다.

검증할 것:
- 방금 생성한 pending 신청이 approvals 쪽에서 보이는지
- 소속 매장 / 이름 / 닉네임 / 전화번호 등 운영상 필요한 식별 정보가 확인 가능한지
- 승인 action이 가능한지

주의:
- approvals UI가 없으면 API라도 검증
- approvals consumer가 실제로 signup producer를 받아먹는지 확인하는 게 핵심

---

### STEP 5 — 승인 처리 검증

방금 생성한 pending membership을 approve 한다.

검증할 것:
- status가 approved 로 바뀌는지
- approved_by / approved_at 반영 여부
- audit 또는 기존 승인 기록 흐름이 깨지지 않는지

---

### STEP 6 — 승인 후 로그인 검증

같은 계정으로 다시 로그인한다.

검증할 것:
- 로그인 성공하는지
- 기존 login route 흐름과 충돌 없는지
- role = hostess 로 정상 분기되는지
- store linkage 가 유지되는지

---

## DUPLICATE / SAFETY VALIDATION

가능하면 추가 검증:

### CASE A — duplicate email
같은 email로 다시 signup 시도

검증:
- duplicate 차단되는지
- 적절한 409 또는 오류 메시지 반환되는지

### CASE B — duplicate phone / same-store duplicate hostess request
현재 설계가 막으려는 중복이 실제로 막히는지 확인

---

## ALLOWED CHANGES

이번 라운드는 기본적으로 검증 라운드다.

허용:
- 검증 중 발견된 **명백한 버그의 최소 수정**
- 검증을 위해 필요한 아주 작은 수정

비허용:
- signup 구조 재설계
- role 확장
- approvals 구조 재설계
- login/auth 대공사
- migration 추가
- schema 변경
- unrelated UI 수정

원칙:
- 버그가 발견되면 최소 범위로만 수정
- 수정한 경우 반드시 BUGS FOUND / FIXES APPLIED 에 명시

---

## VALIDATION REQUIREMENTS

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`

그리고 실제 흐름 검증:

3. signup 성공 확인
4. pending row 확인
5. 승인 전 로그인 차단 확인
6. approvals 확인
7. approve 처리 확인
8. 승인 후 로그인 성공 확인

가능하면 추가:
9. duplicate case 확인

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. signup 성공처럼 보이나 pending membership이 생성되지 않음
2. role이 hostess가 아님
3. 승인 전 로그인 차단이 안 됨
4. approvals에서 신규 pending 신청이 안 보임
5. 승인 후에도 로그인 안 됨
6. store linkage 틀림
7. full_name / nickname / phone 저장 누락
8. duplicate protection 작동 안 함
9. build 실패
10. type error 발생

---

## OUTPUT FORMAT

### 1. TEST RESULTS
- signup
- pending creation
- pre-approval login block
- approvals visibility
- approval action
- post-approval login
- duplicate cases

### 2. BUGS FOUND
- 실제 발견된 버그만
- 추측 금지

### 3. FIXES APPLIED
- 수정한 파일
- 수정 이유
- 최소 수정 설명

### 4. DATA VERIFIED
- profile fields
- membership status
- role
- store linkage

### 5. VALIDATION
- 실행 명령과 결과

### 6. FINAL STATUS
- PASS / FAIL
- 한 줄 결론

---

## ONE-LINE SUMMARY

NOX의 signup → pending → approval → login 허용 흐름이
실제로 정상 동작하는지 검증하고,
깨진 지점이 있으면 최소 범위로 수정하라.