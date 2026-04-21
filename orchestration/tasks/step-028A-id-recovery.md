# STEP-028A — ID RECOVERY (SELF-SERVICE)

## OBJECTIVE

NOX 가입자가 증가함에 따라
운영자가 직접 아이디(이메일)를 찾아주는 구조는 유지 불가능하다.

이번 라운드의 목적은
**사용자가 직접 아이디를 확인할 수 있는 self-service 흐름을 구현하는 것**이다.

단, 보안상 이메일 전체를 노출하지 않고
**마스킹된 이메일만 반환하는 방식**으로 구현한다.

---

## LOCKED POLICY

아이디 찾기 입력값:

- 소속 매장
- 이름 (full_name)
- 전화번호 (phone)

결과:

- 이메일 전체 노출 ❌
- 마스킹된 이메일만 노출 ⭕

예:
- ab***@gmail.com
- jo****@nox.local

---

## PRIMARY TASKS

### TASK 1 — API 생성

파일:

- `app/api/auth/find-id/route.ts`

POST only.

입력:

```json
{
  "store": "마블",
  "full_name": "홍길동",
  "phone": "01012345678"
}