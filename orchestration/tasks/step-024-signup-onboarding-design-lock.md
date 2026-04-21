# STEP-024 — SIGNUP / PENDING APPROVAL DESIGN LOCK

## OBJECTIVE

현재 NOX는 로그인과 승인 구조는 존재하지만,
일반 사용자가 직접 가입 신청을 하는 signup / onboarding 흐름은 구현되어 있지 않다.

이번 작업의 목적은
**NOX 회원가입 구조를 실제 운영 기준으로 설계 고정(lock)하는 것**이다.

이 단계에서는 구현을 서두르지 말고,
먼저 회원가입 입력값 / 승인 흐름 / 로그인 차단 규칙 / UX 메시지를
추측 없이 문서로 확정한다.

즉:

- signup 정책 정의
- pending approval 구조 정의
- 승인 전/후 UX 정의
- 현재 approvals 구조와 어떻게 연결될지 정의

이번 라운드는 **설계 잠금 라운드**다.

---

## LOCKED INPUT (USER CONFIRMED)

회원가입 시 사용자가 반드시 입력해야 하는 정보:

1. 소속 매장
   - 5~8층 매장 중 선택
   - 운영자가 보는 승인 대상 매장을 명확히 하기 위함

2. 이름
   - 본명

3. 닉네임
   - 사용자가 현장에서 쓰고 싶은 이름

4. 전화번호
   - 이상한 사람 / 허위 가입 방지
   - 운영 확인용 식별 정보

이 네 가지는 회원가입 신청 시 필수 입력이다.

---

## CONTEXT

현재 코드베이스 감사 결과 기준:

- login flow는 구현되어 있음
- approved membership만 로그인 가능
- approvals UI는 존재함
- 하지만 public signup / pending 생성 엔드유저 흐름은 없음

즉 현재는:

- 로그인 가능 구조는 있음
- 승인 처리 구조는 있음
- 가입 신청 구조만 없음

이번 STEP-024에서는
이 빈 부분을 어떻게 메울지 설계 문서로 고정해야 한다.

---

## DESIGN GOAL

회원가입은 일반 서비스형 “즉시 사용”이 아니라
**가입 신청 → pending → 운영자 승인 → 로그인 허용**
구조여야 한다.

핵심 목적:

- 아무나 바로 들어오지 못하게 할 것
- 운영자가 신청자 정보를 보고 승인/거절할 수 있어야 할 것
- 소속 매장을 명확히 할 것
- 운영상 식별 가능한 정보만 받도록 할 것

---

## REQUIRED DESIGN QUESTIONS TO ANSWER

아래 항목들을 현재 구조 기준으로 답할 것.
추측 금지. 현재 코드와 도메인 규칙을 보고 가장 안전한 설계를 제시할 것.

### 1. 회원가입 입력 필드

최소 필수 입력:

- 소속 매장
- 이름
- 닉네임
- 전화번호

추가로 현재 auth에 필수적인 값이 있다면 식별할 것:
- email
- password
- 그 외 필요한 최소 필드

질문:
- email/password는 signup에 반드시 포함되어야 하는가?
- 현재 login 구조상 빠질 수 없는가?
- 위 4개 외에 현재 시스템 안정성상 꼭 필요한 필드가 있는가?

주의:
- 사용자가 확정한 4개 필드는 제거 금지
- 추가 필드는 현재 코드 기준으로 반드시 필요한 경우에만 제안

---

### 2. 소속 매장 선택 방식

회원가입 시 사용자는 5~8층 매장 중 하나를 선택해야 한다.

설계해야 할 것:

- 매장 선택은 dropdown인지 radio인지
- 실제 어떤 store 목록을 보여줘야 하는지
- store_uuid와 어떻게 연결할지
- 사용자가 존재하지 않는 매장을 선택하지 못하게 하려면 어떻게 해야 하는지

현재 도메인 기준 참고:
- 5층: Marvel / Burning / Hwangjini / Live
- 향후 6~8층까지 확장 가능

---

### 3. membership 생성 방식

signup 성공 시 어떤 레코드가 생성되어야 하는지 정의할 것.

반드시 판단해야 할 것:

- auth 계정 생성 여부
- profiles row 생성 여부
- store_memberships row 생성 여부
- 초기 status는 pending인지
- role은 signup 시 선택하는지 / 기본값인지 / 승인 시 정하는지

현재 코드 기준에서 가장 안전한 구조를 제안할 것.

---

### 4. 승인 흐름 연결

현재 approvals UI / route가 존재한다면,
signup으로 생성된 pending membership이 그 화면에서 처리될 수 있어야 한다.

판단해야 할 것:

- approvals 화면이 pending signup을 그대로 처리 가능한지
- 추가 정보(이름/닉네임/전화번호)가 approvals 화면에 보여야 하는지
- 승인/거절 시 어떤 상태 전이가 필요한지

---

### 5. 승인 전 로그인 처리

회원가입 신청 후 승인 전 상태의 사용자가 로그인 시도하면
어떤 메시지를 보여야 하는지 설계할 것.

현재 login route는 approved만 통과시키는 구조이므로,
이를 기준으로 UX 메시지를 정의할 것.

예:
- 승인 대기 중입니다
- 운영자 승인 후 로그인 가능합니다

주의:
- 현재 구현을 깨지 않는 방향 우선
- route/API에서 줄 수 있는 메시지와 UI 표시 방식을 구분해서 설명할 것

---

### 6. 중복 가입 처리

다음을 어떻게 처리할지 정의할 것:

- 같은 이메일로 중복 가입
- 같은 전화번호로 중복 가입
- 같은 이름/닉네임 다른 가입

현재 auth / membership 구조 기준으로
가장 안전한 정책을 제안할 것.

---

### 7. 보안 / 운영 관점

왜 이 구조가 필요한지 설명할 것:

- 이상한 사람 가입 방지
- 운영 확인 가능
- 매장 소속 명확화
- 승인 전 사용 차단

단순 UX가 아니라
운영 시스템 관점에서 설명할 것.

---

## REQUIRED OUTPUT

이번 라운드의 출력은 **구현 코드가 아니라 설계 잠금 문서**여야 한다.

반드시 아래 항목 포함:

### 1. CURRENT CODE REALITY
- 현재 구현되어 있는 것
- 현재 없는 것

### 2. LOCKED SIGNUP INPUTS
- 확정 필드
- 추가 필요 필드가 있다면 근거 포함

### 3. PROPOSED SIGNUP FLOW
예:
- signup page
- auth user creation
- pending membership creation
- approval
- login enable

### 4. MEMBERSHIP / STATUS DESIGN
- 어떤 row가 언제 생기는지
- pending / approved / rejected / suspended 처리

### 5. LOGIN BEHAVIOR BEFORE APPROVAL
- 승인 전 로그인 시 어떤 동작/메시지로 갈지

### 6. APPROVAL UI IMPACT
- approvals page/route에 어떤 정보가 더 필요할지

### 7. DUPLICATE / SAFETY RULES
- 이메일/전화번호/중복 처리 정책

### 8. IMPLEMENTATION PLAN
이 설계를 구현하려면 다음에 어떤 STEP으로 나눠야 하는지
예:
- STEP-025 signup UI/API
- STEP-026 approvals UI enrichment
- STEP-027 runtime validation

---

## CONSTRAINTS

1. NO GUESSING
2. 현재 코드 구조 기준으로 설계할 것
3. 실제 구현 없는 것을 이미 있는 척 쓰지 말 것
4. 지금은 구현하지 말 것
5. schema 변경이 필요하다면 “필요 가능성”으로만 적고 단정하지 말 것
6. signup을 “아무나 바로 사용 가능” 구조로 설계하지 말 것
7. 운영 승인형 구조를 유지할 것

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. 사용자가 확정한 입력값 4개를 누락
2. 즉시 사용 가능한 공개 회원가입으로 설계
3. 현재 approvals 구조를 무시
4. 현재 login approved-only 구조를 무시
5. 현재 코드에 없는 것을 이미 구현된 것처럼 서술
6. 구현까지 해버림

---

## ONE-LINE SUMMARY

NOX 회원가입을
“소속 매장 + 이름 + 닉네임 + 전화번호 기반의 가입 신청 → pending → 운영자 승인 → 로그인 허용”
구조로 설계 고정하라.