# STEP-028C — ACCOUNT RECOVERY UI

## OBJECTIVE

현재 NOX는 다음 API가 준비된 상태다:

- `/api/auth/find-id`
- `/api/auth/reset-password`

하지만 사용자 UI는 아직 없다.

이번 라운드의 목적은
**사용자가 직접 아이디 찾기 / 비밀번호 재설정을 수행할 수 있는 UI를 구현하는 것**이다.

---

## PRIMARY TASKS

### TASK 1 — 아이디 찾기 페이지

파일:

- `app/find-id/page.tsx`

기능:

입력:
- 소속 매장
- 이름
- 전화번호

동작:
- `/api/auth/find-id` POST 호출

결과:

1. 성공:
   - 마스킹된 이메일 표시

2. pending:
   - "가입 신청이 접수되었습니다. 승인 후 로그인할 수 있습니다."

3. not found:
   - "일치하는 계정을 찾을 수 없습니다."

---

### TASK 2 — 비밀번호 재설정 페이지

파일:

- `app/reset-password/page.tsx`

기능:

입력:
- 이메일

동작:
- `/api/auth/reset-password` POST 호출

결과:

- 항상 동일 메시지 표시:
  - "비밀번호 재설정 이메일이 발송되었습니다."

---

### TASK 3 — login 페이지 진입 링크 추가

파일:

- `app/login/page.tsx`

추가:

- "아이디 찾기" → `/find-id`
- "비밀번호 찾기" → `/reset-password`

주의:

- 작은 텍스트 링크
- 강한 CTA 금지
- 기존 스타일 유지

---

## UI REQUIREMENTS

공통:

- login과 동일한 스타일
- dark background + glass card
- 입력 필드 + 버튼
- error / success 메시지 영역

---

## VALIDATION

- npx tsc --noEmit
- npm run build
- /find-id 렌더 확인
- /reset-password 렌더 확인
- login 링크 확인

---

## FAIL CONDITIONS

- API 호출 안 됨
- 이메일 노출 정책 깨짐
- login 페이지 깨짐
- build 실패

---

## OUTPUT FORMAT

### 1. FILES CHANGED

### 2. WHAT WAS IMPLEMENTED

### 3. API CONNECTION

### 4. UX FLOW

### 5. VALIDATION

### 6. FINAL STATUS

---

## ONE-LINE SUMMARY

사용자가 직접 아이디 찾기와 비밀번호 재설정을 수행할 수 있도록 UI를 구현하라.