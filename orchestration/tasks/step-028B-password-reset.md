# STEP-028B — PASSWORD RESET (SELF-SERVICE)

## OBJECTIVE

NOX 가입자가 증가함에 따라
운영자가 직접 비밀번호를 재설정해주는 구조는 유지 불가능하다.

이번 라운드의 목적은
**사용자가 직접 비밀번호를 재설정할 수 있는 흐름을 구현하는 것**이다.

기반:

- Supabase password reset email 기능 사용

---

## LOCKED POLICY

- 비밀번호는 사용자 본인만 재설정 가능
- 이메일 기반 reset
- reset link는 이메일로 발송
- 승인된 계정(approved)만 reset 허용

---

## PRIMARY TASKS

### TASK 1 — API 생성

파일:

- `app/api/auth/reset-password/route.ts`

POST only.

입력:

```json
{
  "email": "user@example.com"
}