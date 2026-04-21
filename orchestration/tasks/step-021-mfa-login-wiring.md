# STEP-021 — MFA LOGIN FLOW WIRING

## OBJECTIVE

현재 서버 로그인 라우트는 MFA 활성 사용자에 대해
`{ mfa_required: true, user_id }`
응답을 반환할 수 있다.

하지만 현재 `app/login/page.tsx` 는 이 분기를 처리하지 않는다.

그 결과:

- access_token 없는 응답을 정상 로그인처럼 처리할 위험이 있고
- MFA 활성 계정이 실제 로그인 불능 상태에 빠질 수 있다

이번 작업의 목적은 **기존 서버 구현을 기준으로 로그인 클라이언트 분기를 안전하게 연결**하는 것이다.

즉:

- `mfa_required` 응답을 감지
- 일반 로그인 성공과 분리
- 잘못된 localStorage 저장 방지
- MFA 후속 인증 단계로 안전하게 넘길 준비
- 추측으로 새 인증 정책 만들지 않기

---

## LOCKED RULES

1. **NO GUESSING**
2. 서버 구현이 이미 있는 범위만 연결
3. MFA 정책을 새로 설계하지 말 것
4. signup / forgot-password / reauth 를 이번 라운드에 구현하지 말 것
5. 로그인 화면 전체 리디자인 금지
6. 최소 수정으로 로그인 분기만 안전하게 고칠 것

---

## FIRST AUDIT BEFORE EDIT

수정 전에 아래를 실제 코드 기준으로 먼저 확인할 것:

1. `app/api/auth/login/route.ts`
   - `mfa_required` 응답 shape
   - 필요한 필드 (`user_id`, 추가 필드 여부)
   - trusted device 관련 입력 필요 여부
   - device_id를 받는지 여부

2. `app/api/auth/login/mfa/route.ts`
   - MFA 완료 API 입력/출력 shape
   - 어떤 값을 받아야 하는지 (`user_id`, `code`, `device_id`, etc.)
   - 성공 시 반환값 shape (`access_token`, `membership_id`, `role`, `store_uuid`, etc.)

3. MFA 관련 페이지 존재 여부
   - `app/login/mfa/page.tsx`
   - `app/**/mfa/**`
   - 기존에 연결 가능한 UI 존재 여부

4. `app/login/page.tsx`
   - 현재 로그인 성공 처리
   - localStorage 저장 위치
   - role routing 처리
   - error 처리

---

## WHAT MUST BE DETERMINED FROM CODE

수정 전 반드시 코드로 확인할 것:

1. 서버가 `mfa_required`일 때 정확히 어떤 값을 주는가
2. MFA 완료를 위해 어떤 API를 호출해야 하는가
3. MFA 전용 페이지가 이미 있는가, 없는가
4. 없는 경우 이번 라운드에서 최소 구현이 필요한 범위가 어디까지인가

---

## PRIMARY TASKS

### TASK 1 — login page에서 mfa_required 분기 처리

`app/login/page.tsx` 에서:

- `/api/auth/login` 응답이 `mfa_required: true` 이면
  - 일반 로그인 성공 흐름으로 처리하지 말 것
  - `access_token` 저장 금지
  - role route 이동 금지
  - MFA 후속 단계로 넘길 것

이때 필요한 데이터는 **실제 서버 응답 기준으로만 사용**할 것.

---

### TASK 2 — 최소 MFA 후속 진입 경로 연결

아래 둘 중 **코드 상태에 맞는 최소 안전 방식**으로 구현:

#### 경우 A: 이미 MFA 페이지/화면이 있으면
- 그쪽으로 정상 연결

#### 경우 B: MFA 페이지가 없고 API만 있으면
- 최소 전용 페이지를 만들어도 됨
- 단, 반드시 기존 API contract 기준으로만 연결
- 디자인 작업 금지
- 단순 입력 + 제출 + 에러 표시 + 성공 시 기존 로그인 성공 처리 재사용 수준만 허용

---

### TASK 3 — MFA 성공 시 기존 로그인 성공 처리와 정렬

MFA 성공 후에는 기존 로그인 성공과 동일하게:

- access_token 저장
- user_id 저장
- membership_id 저장
- role 저장
- store_uuid 저장
- 역할별 route 이동

단, 저장 키와 라우팅은 **현재 login page 기존 구현과 동일한 방식 재사용 우선**

---

### TASK 4 — 잘못된 상태 방지

다음을 반드시 막을 것:

- `access_token` 없는 상태에서 localStorage 저장
- `undefined` 저장
- MFA 미완료 상태에서 `/owner`, `/manager`, `/me`, `/counter` 이동
- 서버 shape 추측 처리

---

## ALLOWED FILES

우선 허용:

- `C:\work\nox\app\login\page.tsx`

조건부 허용:
- `C:\work\nox\app\login\mfa\page.tsx`
- `C:\work\nox\app\login\mfa\*.tsx`
- `C:\work\nox\app\login\mfa\*.ts`
- 로그인 MFA 연결에 직접 필요한 최소 파일

조건부 허용 원칙:
- 기존 MFA 전용 페이지가 없을 때만 새 페이지 추가 검토
- 범위 최소화
- 공통 helper 분리가 꼭 필요한 경우에만 허용
- unrelated refactor 금지

---

## FORBIDDEN FILES

- signup 관련 파일 신규 생성
- forgot/reset password 관련 파일 신규 생성
- reauth UI 신규 생성
- approvals flow 변경
- Supabase schema / migration 변경
- printer-server 변경
- payout / settlement / chat / cross-store 변경
- 환경변수 변경
- Cloud Run 설정 변경

---

## CONSTRAINTS

1. **DO NOT INVENT MFA POLICY**
   - TOTP인지, trusted device 정책이 어떤지, remember device가 어떻게 동작하는지
     실제 코드 기준만 사용

2. **DO NOT CHANGE LOGIN API CONTRACT**
   - 서버 라우트를 임의 변경하지 말 것
   - 정말 필요한 경우에만 변경 가능하며, 그 경우 이유를 명확히 보고할 것
   - 기본 원칙은 클라이언트 연결만 수정

3. **MINIMAL SAFE FIX**
   - 이번 라운드는 버그 수정 라운드
   - 구조 개선 라운드 아님

4. **NO VISUAL OVERHAUL**
   - 로그인 화면 전체 디자인 변경 금지
   - MFA 페이지를 만들더라도 최소 UI만 허용

---

## VALIDATION

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`

가능하면 추가 확인:

3. 일반 로그인 흐름이 그대로 유지되는지
4. MFA required 응답 경로가 정상 분기되는지
5. MFA 성공 시 기존 role route로 정상 이동하는지
6. token 없이 보호 페이지로 가는 잘못된 흐름이 없는지

테스트 계정이 없어 실전 MFA 완료까지 못 가면,
최소한 코드 레벨에서 다음을 증명할 것:

- `mfa_required` 분기 처리 존재
- 일반 로그인 처리와 분리됨
- undefined token 저장 방지됨
- MFA 완료 API 연결 경로가 존재함

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. `mfa_required` 응답을 여전히 일반 로그인처럼 처리함
2. token 없는 상태를 저장함
3. MFA 정책을 추측으로 구현함
4. unrelated 파일 대량 수정
5. signup / forgot-password / reauth 범위까지 건드림
6. build 실패
7. type error 발생

---

## OUTPUT FORMAT

### 1. FILES CHANGED
- 정확한 경로

### 2. MFA CONTRACT FOUND
- login route의 `mfa_required` 응답 shape
- login/mfa route의 입력/출력 shape
- 실제 코드 근거 설명

### 3. WHAT WAS CHANGED
- login page에서 어떤 분기를 추가했는지
- 새 MFA page를 만들었는지 여부
- 일반 로그인 / MFA 로그인 흐름이 어떻게 분리되었는지

### 4. SAFETY GUARARDS
- undefined token 저장 방지
- premature route 이동 방지
- error handling 방식

### 5. VALIDATION
- 실행 명령과 결과

### 6. KNOWN LIMITS
- 테스트 계정 부재 등으로 실제 확인 못 한 부분
- 다음 라운드로 넘겨야 할 부분

---

## ONE-LINE TASK SUMMARY

서버에 이미 존재하는 MFA 로그인 계약을 기준으로
클라이언트 로그인 흐름을 안전하게 연결하고,
MFA 활성 계정이 깨진 상태에 빠지지 않도록 최소 범위로 수정하라.