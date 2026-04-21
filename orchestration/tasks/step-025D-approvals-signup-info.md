# STEP-025D — APPROVALS SIGNUP INFO VALIDATION / MINIMAL FIX

## OBJECTIVE

현재 NOX signup 흐름은
signup → pending membership → approval → login 허용
구조로 정렬되고 있다.

이번 라운드의 목적은
**approvals 흐름에서 신규 signup 신청자를 운영자가 충분한 정보와 함께 식별할 수 있는지 검증하고,
부족하면 최소 범위로 수정하는 것**이다.

운영자가 승인 전에 최소한 확인할 수 있어야 하는 정보:

- 소속 매장
- 이름
- 닉네임
- 전화번호

이번 라운드는 approvals UX 전체 개편이 아니라
**signup 신청 식별 정보 노출 보강**이 목적이다.

---

## PRIMARY QUESTIONS TO VERIFY

실제 코드/실행 기준으로 다음을 확인할 것:

1. approvals page 또는 approvals API에서 pending 신청자가 보이는가
2. 방금 signup으로 생성된 pending hostess 신청이 consumer에 잡히는가
3. 운영자가 아래 정보를 볼 수 있는가
   - 소속 매장
   - 이름
   - 닉네임
   - 전화번호
4. approve / reject action이 그대로 작동하는가

---

## REQUIRED VALIDATION

### STEP 1 — approvals consumer 확인

검증 대상:
- `app/approvals/page.tsx`
- `app/api/store/approvals/route.ts`

확인할 것:
- pending membership 조회 기준
- signup producer가 만든 row를 그대로 소비하는지
- profiles join 또는 store join 이 있는지

---

### STEP 2 — 운영 식별 정보 노출 검증

반드시 확인:

- store name 표시 여부
- full_name 표시 여부
- nickname 표시 여부
- phone 표시 여부

없으면:
- 어디가 빠졌는지 정확히 식별
- 최소 범위 수정

---

### STEP 3 — approve/reject 유지 검증

정보 노출 보강 후에도 다음이 깨지면 안 된다:

- approve
- reject
- pending 목록 갱신
- status 변경

---

## ALLOWED CHANGES

허용:
- `app/approvals/page.tsx`
- `app/api/store/approvals/route.ts`

조건부 허용:
- approvals에서 필요한 최소 helper
- 타입 정리 수준의 최소 수정

비허용:
- signup 구조 재설계
- login/auth 수정
- schema 변경
- migration 추가
- approvals 전체 리디자인
- unrelated UI 수정

---

## CONSTRAINTS

1. NO GUESSING
2. consumer는 기존 구조 최대 재사용
3. signup 신청 식별 정보 보강만 다룰 것
4. 기존 approve/reject 흐름 깨지면 안 됨
5. 가능한 최소 수정

---

## VALIDATION

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`

그리고 실제 또는 코드 기반 검증:
3. pending 신청 표시 확인
4. 식별 정보 표시 확인
5. approve/reject 유지 확인

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. pending 신청이 approvals에 안 보임
2. 이름/닉네임/전화번호/매장 중 핵심 정보가 누락됨
3. approve/reject 흐름이 깨짐
4. unrelated 파일 대량 수정
5. build 실패
6. type error 발생

---

## OUTPUT FORMAT

### 1. FILES CHANGED
- 정확한 경로

### 2. APPROVALS DATA FLOW FOUND
- 어떤 join/select로 데이터를 읽는지
- signup producer row를 어떻게 소비하는지

### 3. WHAT WAS MISSING
- 어떤 정보가 원래 안 보였는지

### 4. WHAT WAS CHANGED
- 어떤 필드 표시를 추가/보강했는지

### 5. VALIDATION
- 실행 명령과 결과

### 6. FINAL STATUS
- PASS / FAIL
- 한 줄 결론

---

## ONE-LINE SUMMARY

NOX approvals 흐름에서 signup 신청자의
소속 매장 / 이름 / 닉네임 / 전화번호가 운영자에게 충분히 보이는지 검증하고,
부족하면 최소 범위로 보강하라.