# STEP-025A — SIGNUP PAGE IMPLEMENTATION

## OBJECTIVE

현재 NOX는 회원가입 설계 잠금이 완료되었고,
다음으로 필요한 것은 **사용자가 실제로 가입 신청을 입력할 수 있는 signup page**다.

이번 라운드의 목적은:

- `app/signup/page.tsx` 생성 또는 구현
- 설계 잠금 기준에 맞는 입력 UI 구성
- 아직 API가 없더라도, 이후 `/api/auth/signup` 과 연결 가능한 형태로 구성
- 추측 없이 현재 설계 문서 기준만 반영

이번 라운드는 **signup page UI 구현만** 다룬다.

---

## LOCKED DESIGN INPUTS

회원가입 시 필수 입력값:

1. 소속 매장
2. 이름
3. 닉네임
4. 전화번호
5. 이메일
6. 비밀번호

역할(role):
- 이번 signup은 `hostess` 전용
- owner / manager / counter signup 금지

승인 모델:
- signup request → pending → 운영자 승인 → 로그인 허용

---

## SCOPE

### 이번 라운드에 포함

- `app/signup/page.tsx` 구현
- 필수 입력 UI 생성
- form state / validation
- submit handler 뼈대 연결
- `/api/auth/signup` 호출 준비
- 성공/실패 메시지 자리 구성
- 로그인 페이지에서 `/signup` 진입 가능하도록 최소 연결이 필요하면 반영

### 이번 라운드에 포함하지 않음

- 실제 signup API 구현
- Supabase auth user 생성
- profile insert/update
- membership pending insert
- approvals UI 수정
- 로그인 route/auth logic 변경
- forgot/reset 기능

---

## REQUIRED PAGE FIELDS

반드시 화면에 있어야 하는 입력값:

- 소속 매장 선택
- 이름
- 닉네임
- 전화번호
- 이메일
- 비밀번호

추가 규칙:

- role 선택 UI 만들지 말 것
- 회원가입은 hostess 신청으로 고정
- 승인형 구조임을 안내 문구로 명확히 할 것

예시 안내 문구 방향:
- "회원가입 신청 후 운영자 승인 완료 시 로그인할 수 있습니다."
- "소속 매장과 본인 정보를 정확히 입력하세요."

---

## STORE SELECTION RULE

매장 선택은 현재 고정 옵션으로 구현 가능:

- Marvel
- Burning
- Hwangjini
- Live

단, 코드베이스에 이미 store list API 또는 auth-safe store fetch 경로가 있다면
그걸 재사용할지 먼저 확인할 것.

우선순위:

1. 기존 store fetch 경로가 있으면 재사용
2. 없으면 임시로 고정 옵션 사용
3. 단, 추측으로 존재하지 않는 API 만들지 말 것

이번 라운드에서는 signup page만 구현하므로
고정 옵션 사용도 허용한다.

---

## VALIDATION RULES

클라이언트 단에서 최소한 아래 검증:

- 소속 매장 선택 여부
- 이름 비어있음 방지
- 닉네임 비어있음 방지
- 전화번호 비어있음 방지
- 이메일 비어있음 방지
- 비밀번호 비어있음 방지

가능하면 추가:

- 이메일 형식 기본 검증
- 전화번호 숫자/문자열 정리
- 비밀번호 최소 길이 검증

단, 서버 정책을 추측해 과한 validation 만들지 말 것.

---

## SUBMIT BEHAVIOR

submit 시 동작:

- `/api/auth/signup` 가 아직 없으면
  - 연결 준비만 해도 됨
  - 단, 호출 shape는 설계 기준과 맞춰둘 것

기본 request shape 목표:

```json
{
  "store": "...",
  "full_name": "...",
  "nickname": "...",
  "phone": "...",
  "email": "...",
  "password": "..."
}