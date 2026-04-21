# STEP-025E — LOGIN / SIGNUP UX ALIGNMENT

## OBJECTIVE

현재 NOX는 signup → pending → approval → login 허용
실제 흐름이 동작한다.

하지만 login 화면의 문구와 진입 UX는
이전 “운영자 생성형” 정책 기준으로 정리된 흔적이 남아 있을 수 있다.

이번 라운드의 목적은
**현재 실제 동작과 login/signup UX를 일치시키는 것**이다.

즉:

- login 화면 문구가 현재 signup 정책과 충돌하지 않게 정리
- signup 진입 경로를 최소 범위로 추가 또는 정리
- 공개 즉시가입처럼 보이지 않도록 유지
- approval-based 운영 구조를 사용자에게 명확히 안내

이번 라운드는 기능 추가가 아니라
**정책/문구/진입 UX 정렬 라운드**다.

---

## CURRENT REALITY TO ALIGN WITH

현재 실제 동작:

- `/signup` 존재
- `/api/auth/signup` 존재
- signup 시 pending membership 생성
- 승인 전 login 차단
- approvals 에서 approve/reject 가능
- 승인 후 login 허용

즉, 현재 정책은:

- 아무나 즉시 사용 가능 ❌
- 가입 신청 가능 ✅
- 운영자 승인 후 사용 가능 ✅

---

## PRIMARY QUESTIONS

반드시 실제 코드 기준으로 확인:

1. 현재 `app/login/page.tsx` 에 어떤 문구가 있는가
2. 현재 문구가 signup 존재 사실과 충돌하는가
3. `/login` 에서 `/signup` 으로 가는 최소 안전 진입 링크가 필요한가
4. 그 링크가 공개 회원가입처럼 오해를 만들지 않는가

---

## GOAL UX

login 화면은 아래 의미를 전달해야 한다:

- 계정은 승인 후 사용할 수 있음
- 아직 계정이 없으면 가입 신청 가능
- 가입 신청 후 바로 로그인되는 구조는 아님

예시 방향:
- "회원가입 신청 후 운영자 승인 완료 시 로그인할 수 있습니다."
- "아직 계정이 없나요? 가입 신청"
- "승인되지 않은 계정은 로그인할 수 없습니다."

주의:
- “바로 가입해서 바로 사용 가능”처럼 보이면 안 됨
- “운영자만 계정 발급 가능”으로 남아 있어도 안 됨
- 현재 실제 동작과 정확히 맞아야 함

---

## ALLOWED CHANGES

허용:
- `app/login/page.tsx`
- 필요 시 아주 작은 범위의 `/signup` 진입 링크 추가

조건부 허용:
- `app/signup/page.tsx` 의 문구 미세 조정 (정말 필요할 때만)

비허용:
- signup API 변경
- login API 변경
- approvals 변경
- auth 구조 변경
- 디자인 전면 개편
- MFA / reauth / settlement / payout / chat 수정

---

## REQUIRED TASKS

### TASK 1 — login 문구 점검 및 정렬

확인할 것:
- "계정 발급 및 승인은 운영 관리자에게 문의하세요." 같은 문구가
  현재 signup 구조와 충돌하는지

필요 시 수정할 것:
- 현재 실제 구조에 맞는 문구로

---

### TASK 2 — signup 진입 링크 판단

현재 `/login` 에서 `/signup` 진입이 없는 경우,
최소 범위 링크를 추가할지 판단할 것.

원칙:
- 있어야 사용자가 가입 신청 가능함
- 하지만 너무 강한 CTA로 보이면 안 됨
- 작은 텍스트 링크 또는 보조 액션 수준이면 충분

---

### TASK 3 — approval-based 안내 유지

login 또는 signup 어느 쪽이든
반드시 다음 의미가 사용자에게 드러나야 한다:

- 가입 신청 후 승인 필요
- 승인 전 로그인 불가

---

## CONSTRAINTS

1. NO GUESSING
2. 정책/문구 정렬만 다룰 것
3. 기능 변경 금지
4. signup을 즉시 사용 가능한 공개 회원가입처럼 보이게 만들지 말 것
5. 최소 수정
6. 기존 login 카드 스타일 유지

---

## VALIDATION

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`

가능하면 추가:
3. `/login` 렌더 확인
4. `/signup` 진입 확인
5. 문구가 현재 구조와 일치하는지 육안 확인

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. login 문구가 실제 동작과 여전히 충돌
2. signup 링크를 추가했는데 공개 즉시가입처럼 보임
3. unrelated UI 수정
4. build 실패
5. type error 발생

---

## OUTPUT FORMAT

### 1. FILES CHANGED
- 정확한 경로

### 2. CURRENT UX CONFLICT FOUND
- 어떤 문구/진입 구조가 충돌했는지

### 3. WHAT WAS CHANGED
- 어떤 문구를 어떻게 바꿨는지
- signup 진입 링크를 추가했는지 여부

### 4. UX POLICY ALIGNMENT
- 현재 화면이 실제 signup/pending/approval 구조와 어떻게 맞게 되었는지

### 5. VALIDATION
- 실행 명령과 결과

### 6. FINAL STATUS
- PASS / FAIL
- 한 줄 결론

---

## ONE-LINE SUMMARY

현재 실제 signup → pending → approval → login 구조에 맞게
NOX login/signup 진입 UX와 문구를 최소 범위로 정렬하라.