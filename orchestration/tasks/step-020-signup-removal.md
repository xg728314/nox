# STEP-020 — SIGNUP REMOVAL / LOGIN SCREEN DEAD-UI CLEANUP

## OBJECTIVE

현재 NOX는 로그인 화면까지는 접근 가능하지만,  
회원가입 관련 UI가 실제 기능 없이 남아 있어 운영 혼선을 만든다.

이 작업의 목적은 **회원가입 기능을 새로 구현하는 것이 아니라**,  
현재 로그인 화면 및 인증 UX에서 **미구현 회원가입 관련 dead UI를 제거/정리**하여  
운영 정책을 **초대/승인형 로그인 체계**로 명확히 고정하는 것이다.

즉:

- 회원가입 직접 생성 흐름 제거
- dead button 제거
- 사용자가 클릭해도 무반응인 요소 제거
- 로그인 화면 문구를 실제 운영 정책과 일치시킴

---

## LOCKED POLICY

이번 라운드에서 확정하는 정책:

1. **공개 회원가입 사용 안 함**
2. 계정은 내부 승인/생성 기반으로만 운영
3. 로그인 화면에는 실제 동작하지 않는 회원가입 버튼을 남기지 않음
4. "승인 대기 확인", "비밀번호 찾기"도 실제 구현이 없으면 함께 제거
5. 이번 작업에서 **signup 기능 구현 금지**
6. 이번 작업에서 **auth 구조 전면 재설계 금지**
7. 목표는 기능 추가가 아니라 **dead UI 제거 + 운영정책 명확화**

---

## SCOPE

### 이번 작업에 포함

- 로그인 화면의 회원가입 관련 dead UI 제거
- 실제 미구현 인증 보조 버튼 제거 또는 비활성 문구로 정리
- 로그인 화면 카피를 운영 정책에 맞게 수정
- 필요 시 안내 문구 추가:
  - 예: "계정은 관리자 승인 후 사용 가능합니다"
  - 예: "계정 발급은 내부 운영자를 통해 진행됩니다"

### 이번 작업에 포함하지 않음

- signup 페이지 신규 구현
- `/api/auth/signup` 신규 구현
- 이메일 인증 플로우 구현
- 비밀번호 찾기 구현
- 승인 대기 조회 기능 구현
- Supabase auth 정책 변경
- MFA 로직 수정
- RLS 수정
- DB migration 추가

---

## REQUIRED CHECKS FIRST

작업 전에 실제 코드 기준으로 아래를 먼저 확인하고 시작할 것:

1. `app/login/page.tsx`
   - 회원가입 버튼 존재 여부
   - 승인 대기 확인 버튼 존재 여부
   - 비밀번호 찾기 버튼 존재 여부
   - 실제 onClick / Link / form submit 연결 여부

2. 로그인 화면에서 연결되는 실제 페이지 존재 여부
   - `app/signup/page.tsx`
   - `app/(auth)/signup/page.tsx`
   - 기타 signup 관련 경로
   - forgot password 관련 경로
   - pending status check 관련 경로

3. 라우트 존재 여부
   - `/api/auth/signup`
   - `/api/auth/register`
   - `/api/auth/forgot-password`
   - `/api/auth/reset-password`
   - 기타 로그인 화면에서 참조하는 auth route

4. dead import / dead state / dead handler 존재 여부
   - 제거한 버튼과 관련된 import
   - handler 함수
   - useState 값
   - loading/error 상태

---

## PRIMARY TASKS

### TASK 1 — 로그인 화면 dead UI 제거

`app/login/page.tsx` 기준으로:

- 무반응 "계정 생성" 제거
- 무반응 "승인 대기 확인" 제거
- 무반응 "비밀번호 찾기" 제거
- 또는 실제 구현된 것이 없으면 관련 영역 전체 제거

주의:
- 그냥 숨기기만 하지 말고, dead code도 함께 정리
- 시각적으로만 감추고 코드가 남아 있으면 안 됨

---

### TASK 2 — 로그인 정책 문구 정리

로그인 화면 문구를 실제 정책과 일치시킬 것.

권장 방향 예시:

- "승인된 계정으로 로그인"
- "계정 발급 및 승인 문의는 운영 관리자에게 요청"
- "NOX 카운터 운영 시스템"

문구는 과장 없이 간단하게 유지.
존재하지 않는 기능을 암시하면 안 됨.

금지 예시:

- "회원가입 후 바로 사용 가능"
- "승인 대기 상태 확인 가능"
- "비밀번호를 직접 재설정 가능"

---

### TASK 3 — 링크/라우팅 참조 정리

로그인 페이지에서 제거한 버튼이 참조하던:

- `Link`
- `router.push`
- handler
- import
- helper text

전부 제거할 것.

---

### TASK 4 — 실제 구현 없는 auth 보조 페이지 흔적 점검

아래가 존재하면 확인:

- signup 관련 page
- forgot/reset password 관련 page
- pending check 관련 page

정책상 완전히 미사용이며 로그인 화면에서도 더 이상 진입하지 않는다면,
이번 라운드에서는 **삭제 여부를 섣불리 단정하지 말고 먼저 보고**할 것.

즉:

- **참조 제거는 반드시 수행**
- **파일 삭제는 신중하게 판단**
- 삭제 시 영향 범위가 불확실하면 삭제하지 말고 보고만 할 것

---

## CONSTRAINTS

1. **NO GUESSING**
   - 실제 파일/코드 기준으로만 수정
   - 추정으로 signup flow 연결하지 말 것

2. **DO NOT IMPLEMENT NEW FEATURES**
   - 새 회원가입 기능 만들지 말 것
   - 비밀번호 찾기 기능 만들지 말 것
   - 승인 대기 조회 기능 만들지 말 것

3. **MINIMAL SAFE CHANGE**
   - 로그인 화면 dead UI 제거 중심
   - 영향 범위를 최소화할 것

4. **NO STYLE OVERHAUL**
   - 전체 디자인 갈아엎지 말 것
   - 정책 정리 + 버튼 정리 수준으로 제한

5. **NO WIND / NO LEGACY MIX**
   - 작업 대상은 반드시 `C:\work\nox`
   - `wind` 참조/수정 금지

---

## TARGET FILES

우선 점검 및 수정 우선순위:

- `C:\work\nox\app\login\page.tsx`

필요 시 점검 대상:

- `C:\work\nox\app\signup\page.tsx`
- `C:\work\nox\app\api\auth\signup\route.ts`
- `C:\work\nox\app\api\auth\forgot-password\route.ts`
- `C:\work\nox\app\api\auth\reset-password\route.ts`
- 기타 로그인 화면에서 직접 참조하는 auth 관련 파일

---

## ALLOWED CHANGES

허용:

- `app/login/page.tsx` 수정
- 관련 dead import 제거
- 관련 dead handler 제거
- 관련 dead text 제거
- 필요한 범위 내의 아주 작은 UI 문구 수정

조건부 허용:

- 로그인 화면이 참조하는 명백한 미사용 컴포넌트 정리
- 단, 영향 범위 명확할 때만

비허용:

- DB schema 변경
- SQL migration 생성
- auth provider 구조 변경
- Supabase env 변경
- MFA 구조 변경
- Cloud Run 설정 변경
- printer-server 수정
- settlement/payout/chat 수정

---

## VALIDATION

반드시 아래 검증 수행:

1. 정적 검증
   - `npm run build`
   - 가능하면 `npx tsc --noEmit`

2. 동작 검증
   - `/login` 접속
   - 로그인 화면에서 dead button 제거 확인
   - 실제 남은 버튼/입력만 보이는지 확인
   - 로그인 submit 기존 동작이 깨지지 않았는지 확인

3. 회귀 검증
   - 로그인 성공/실패 흐름이 기존 대비 깨지지 않았는지 확인
   - 콘솔 에러/빌드 에러 없는지 확인

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. 회원가입 버튼이 여전히 남아 있는데 무반응
2. 승인 대기 확인 / 비밀번호 찾기 dead button이 그대로 남음
3. signup 기능을 새로 구현해버림
4. 로그인 기능이 깨짐
5. build 또는 tsc 실패
6. unrelated file 대량 수정
7. wind 저장소 건드림

---

## OUTPUT FORMAT

작업 완료 후 반드시 아래 형식으로만 보고:

### 1. FILES CHANGED
- 정확한 파일 경로만 나열

### 2. WHAT WAS REMOVED
- 제거한 버튼/문구/핸들러/링크를 구체적으로 설명

### 3. POLICY ALIGNMENT
- 로그인 화면이 어떻게 "초대/승인형 운영" 정책과 일치하게 되었는지 설명

### 4. VALIDATION
- 실행한 명령어
- build / tsc 결과
- `/login` 확인 결과

### 5. REMAINING AUTH GAPS
- 아직도 미구현으로 남아 있는 인증 관련 항목이 있으면 추측 없이 사실만 적기
- 예:
  - forgot password 미구현
  - signup route 없음
  - approval status self-check 없음

---

## ONE-LINE TASK SUMMARY

NOX 로그인 화면에서 미구현 회원가입/보조 인증 dead UI를 제거하고,
운영 정책을 “내부 승인 계정만 로그인” 구조로 명확히 정렬하라.