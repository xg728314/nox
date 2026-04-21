# STEP-022 — REAUTH UI / CLIENT FLOW WIRING

## OBJECTIVE

현재 NOX 코드베이스에는 재인증(reauth) API와
민감 작업에서의 `REAUTH_REQUIRED` 응답 구조가 이미 존재한다.

하지만 현재 프론트엔드에는 사용자가 이 요구를 실제로 처리할 수 있는
재인증 UI / 흐름이 연결되어 있지 않다.

그 결과:

- 민감 작업 수행 중 `REAUTH_REQUIRED` 가 발생하면
  사용자는 다시 인증할 방법이 없다
- 운영 흐름이 중간에서 끊긴다
- 클라이언트는 서버의 보안 요구사항을 만족시킬 수 없다

이번 작업의 목적은 **이미 존재하는 서버 재인증 계약을 기준으로**
최소 범위의 클라이언트 재인증 흐름을 연결하는 것이다.

즉:

- `REAUTH_REQUIRED` 응답을 사용자가 처리할 수 있게 만들기
- 재인증 입력 UI 연결
- 재인증 성공 후 원래 작업을 다시 시도할 수 있는 최소 기반 마련
- 추측으로 보안 정책을 새로 만들지 않기

---

## LOCKED RULES

1. **NO GUESSING**
2. 서버 구현이 source of truth 이다
3. reauth 정책을 새로 설계하지 말 것
4. signup / forgot-password / approvals / MFA 정책 변경 금지
5. 전체 auth 구조 리팩터링 금지
6. 최소 수정으로 재인증 흐름만 연결할 것

---

## FIRST AUDIT BEFORE EDIT

수정 전에 실제 코드 기준으로 아래를 먼저 확인할 것:

1. `app/api/auth/reauth/route.ts`
   - 입력 shape
   - 출력 shape
   - 성공/실패 응답 형식
   - access token 재발급인지, 최근 인증 시각 갱신인지, 어떤 방식인지

2. `lib/security/guards.ts`
   - `requiresReauth`
   - `hasRecentReauth`
   - 어떤 조건에서 `REAUTH_REQUIRED` 가 발생하는지

3. 실제로 `REAUTH_REQUIRED` 를 반환하는 route들
   - 최소한 예시 파일 몇 개 확인
   - 예: closing / reopen / cross-store / payout cancel 등

4. 현재 클라이언트 코드에서
   - `REAUTH_REQUIRED` 를 공통 처리하는 곳이 있는지
   - axios/fetch wrapper가 있는지
   - modal/page/dialog 기반 재사용 구조가 있는지
   - 이미 reauth UI 흔적이 있는지

5. auth 저장 구조
   - access_token을 어디에 저장하는지
   - 재인증 후 토큰 갱신이 필요한지 여부
   - 또는 단순 서버 측 recent-reauth 상태 갱신인지 여부

---

## WHAT MUST BE DETERMINED FROM CODE

반드시 코드로 확인할 것:

1. 재인증은 비밀번호 재입력 방식인지 다른 방식인지
2. 성공 시 클라이언트가 무엇을 업데이트해야 하는지
3. 서버가 요구하는 최소 request payload 가 무엇인지
4. 재인증 성공 후 기존 요청을 자동 재시도해야 하는지, 수동 재시도만 가능한지
5. 현재 구조상 가장 안전한 UI 형태가 무엇인지
   - modal
   - dedicated page
   - inline prompt
   실제 코드 구조 기준으로 판단할 것

---

## PRIMARY TASKS

### TASK 1 — 최소 reauth UI 진입점 마련

코드 구조 기준으로 가장 안전한 형태로
재인증 입력 UI를 만든다.

우선순위:

#### 경우 A: 이미 재사용 가능한 modal/dialog 구조가 있으면
- 그것을 활용

#### 경우 B: 공용 구조가 없으면
- 최소 전용 page 또는 최소 modal 구현 허용
- 단, 디자인 작업 금지
- 기능 목적만 충족할 것

---

### TASK 2 — reauth API 연결

`app/api/auth/reauth/route.ts` 실제 계약 기준으로:

- 필요한 입력값 제출
- 성공 처리
- 실패 처리
- 사용자 메시지 표시

이때 절대:

- request shape 추측 금지
- 응답 shape 추측 금지

---

### TASK 3 — REAUTH_REQUIRED 처리 연결

최소한 하나 이상의 실제 보호 작업 흐름에서
`REAUTH_REQUIRED` 발생 시 사용자가 대응할 수 있도록 연결할 것.

원칙:

- 전역 intercept를 무리하게 새로 만들 필요는 없음
- 현재 구조상 가장 적은 변경으로 연결할 것
- 예를 들어:
  - 민감 작업 페이지에서 401 + `REAUTH_REQUIRED` 받으면 재인증 UI 열기
  - 성공 후 사용자가 다시 시도 가능하도록 하기

필수:
- 적어도 실제 보호 작업 하나에서는 end-to-end로 이어져야 함

---

### TASK 4 — 성공 후 안전한 후속 처리

코드 기준으로 필요한 후속 처리를 할 것:

- access token 갱신 필요하면 갱신
- 단순 recent reauth 플래그 갱신이면 그에 맞게 처리
- 재인증 성공 후 사용자가 원래 작업을 재시도할 수 있게 만들 것

단, 이번 라운드에서 “모든 보호 작업 자동 재시도”까지 욕심내지 말 것.
최소 안전 방식 우선.

---

## ALLOWED FILES

우선 허용:
- reauth 흐름에 직접 연결되는 최소 파일들

예상 후보:
- `C:\work\nox\app\api\auth\reauth\route.ts` (읽기 우선, 수정은 정말 필요할 때만)
- 재인증 UI를 붙일 실제 클라이언트 페이지/컴포넌트
- 공용 auth helper / fetch helper (정말 필요할 때만)
- `C:\work\nox\app\login\page.tsx` (원칙적으로 이번 작업 핵심은 아님)
- 재인증 전용 page/modal 파일

조건부 허용:
- 하나의 민감 작업 페이지
- 재사용 가능한 작은 client component
- auth 관련 최소 helper

---

## FORBIDDEN FILES

- signup 신규 구현
- forgot/reset password 구현
- MFA 정책 변경
- approvals flow 변경
- settlement 계산 로직 변경
- payout 비즈니스 로직 변경
- DB migration 추가
- printer-server 수정
- Cloud Run 설정 변경
- Supabase schema 변경

---

## CONSTRAINTS

1. **SERVER CONTRACT FIRST**
   - `app/api/auth/reauth/route.ts` 가 source of truth

2. **NO GLOBAL REFACTOR**
   - fetch 전역 래퍼, auth provider 대공사, 앱 전체 intercept 구조 신설 금지
   - 이번 라운드는 최소 safe wiring

3. **MINIMUM WORKING UX**
   - 사용자가 막히지 않으면 된다
   - 예쁘게 만들 필요 없음

4. **DO NOT EXPAND SCOPE**
   - 한 작업이라도 실제로 reauth 대응 가능하게 만들 것
   - 전 페이지 통합은 다음 라운드로 넘겨도 됨

---

## VALIDATION

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`

가능하면 추가 검증:

3. 어떤 페이지/행동에서 `REAUTH_REQUIRED` 를 처리하도록 연결했는지 확인
4. 재인증 UI가 뜨는지 확인
5. 잘못된 payload를 보내지 않는지 확인
6. 재인증 성공 후 사용자가 원래 작업을 다시 수행할 수 있는지 확인

테스트 계정/환경 문제로 실전 확인이 어려우면,
최소한 코드 레벨로 다음을 증명할 것:

- 실제 보호 작업 하나에 연결됨
- `REAUTH_REQUIRED` 분기 존재
- reauth API 호출 경로 존재
- 성공/실패 처리 존재

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. reauth API 계약을 추측으로 사용함
2. REAUTH_REQUIRED 를 여전히 사용자가 처리할 수 없음
3. unrelated 파일 대량 수정
4. auth 전역 구조 대공사
5. build 실패
6. type error 발생
7. signup / forgot / MFA 범위까지 퍼짐

---

## OUTPUT FORMAT

### 1. FILES CHANGED
- 정확한 경로

### 2. REAUTH CONTRACT FOUND
- 입력 shape
- 출력 shape
- 성공 후 의미
- 실제 코드 근거

### 3. WHAT WAS CHANGED
- 어떤 UI를 만들었는지
- 어디에 연결했는지
- 어떤 보호 작업에 연결했는지

### 4. REAUTH HANDLING FLOW
- REAUTH_REQUIRED 발생
- UI 진입
- API 호출
- 성공/실패
- 사용자가 어떻게 다시 시도하는지

### 5. VALIDATION
- 실행 명령과 결과

### 6. KNOWN LIMITS
- 실제로 아직 연결되지 않은 보호 작업
- 테스트 계정 부재 등으로 확인 못 한 부분
- 다음 라운드로 넘겨야 할 부분

---

## ONE-LINE TASK SUMMARY

이미 존재하는 서버 재인증 계약을 기준으로,
최소 범위의 클라이언트 재인증 UI와 처리 흐름을 연결하여
민감 작업 중 `REAUTH_REQUIRED` 가 발생해도 사용자가 작업을 계속할 수 있게 하라.