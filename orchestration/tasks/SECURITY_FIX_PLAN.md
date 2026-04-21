# NOX SECURITY FIX PLAN (EXECUTION)

## RULES
- 추측 금지
- 단계별 실행
- 각 단계 완료 후 반드시 결과 보고

---------------------------------------

## PHASE 0 — 즉시 (P0)

### TASK 0-1 — SERVICE ROLE KEY ROTATION

OBJECTIVE:
Supabase service_role key 폐기 및 교체

STEPS:
1. Supabase Dashboard 접속
2. Settings → API → service_role key RESET
3. 새 키를 .env.local에 저장
4. 코드 내 하드코딩 키 제거

VALIDATION:
- 기존 키로 요청 실패
- 새 키 정상 동작

---------------------------------------

### TASK 0-2 — GIT HISTORY SECRET 제거

STEPS:
- git filter-repo 또는 BFG 실행
- force push

VALIDATION:
- GitHub에서 key 검색 시 없음

---------------------------------------

### TASK 0-3 — 민감 로그 제거

FILES:
- app/api/ops/apply-recovery/stale-pending/route.ts
- app/api/auth/login/route.ts
- app/page.tsx
- app/layout.tsx
- app/login/page.tsx
- middleware.ts

REMOVE:
- CRON_SECRET 로그
- [LATENCY-PROBE]
- login debug 로그

VALIDATION:
grep -rn "CRON_SECRET" app
grep -rn "\[probe\]" app

---------------------------------------

### TASK 0-4 — apiFetch 인증 버그 수정

FILE:
lib/apiFetch.ts

FIX:
if (token) {
  headers.Authorization = `Bearer ${token}`
}

VALIDATION:
- Authorization: Bearer null 없어야 함

---------------------------------------

### TASK 0-5 — pricing 하드코딩 제거

FILE:
lib/session/services/pricingLookup.ts

REMOVE:
?? 30000

REPLACE:
값 없으면 throw

---------------------------------------

## PHASE 1 — HIGH

### TASK 1-1 — localStorage 토큰 제거 (설계 시작)

OBJECTIVE:
HttpOnly 쿠키 기반 전환

---------------------------------------

### TASK 1-2 — 로그인 멤버십 수정

FILE:
app/api/auth/login/route.ts

FIX:
.eq("is_primary", true)

---------------------------------------

### TASK 1-3 — Rate Limit 우회 방지

FILE:
lib/audit/authSecurityLog.ts

ACTION:
X-Forwarded-For 제거
플랫폼 헤더 사용

---------------------------------------

### TASK 1-4 — query injection 방어

TARGET:
- audit-events
- customers
- stores

ACTION:
LIKE escape
OR escape

---------------------------------------

### TASK 1-5 — limit NaN 방어

FIX:
if (!Number.isFinite(limit)) throw error

---------------------------------------

### TASK 1-6 — CRON secret 비교 수정

ACTION:
timingSafeEqual 사용

---------------------------------------

## PHASE 2 — STRUCTURE

### TASK 2-1 — settlement API 정리

ACTION:
- canonical 하나 선택
- 나머지 deprecated

---------------------------------------

### TASK 2-2 — reports 정리

- manager / managers
- hostess / hostesses

---------------------------------------

### TASK 2-3 — 주문/재고 원자화

FILE:
orders/[order_id]/route.ts

ACTION:
SQL 함수로 통합

---------------------------------------

### TASK 2-4 — super-admin 보호 강화

ACTION:
- re-auth
- MFA
- audit 보장

---------------------------------------

### TASK 2-5 — test/mock/WIP 정리

REMOVE:
- _ble_wip
- test-offline
- lib/mock

---------------------------------------

### TASK 2-6 — DB migration 충돌 해결

ACTION:
010_* 파일 정리

---------------------------------------

## PHASE 3 — VALIDATION

### TASK 3-1 — apply-state backfill

---------------------------------------

### TASK 3-2 — 회귀 테스트

CHECK:
- settlement
- apply-actions
- pricing

---------------------------------------

### TASK 3-3 — 로그 정책

ACTION:
민감정보 로그 금지

---------------------------------------

### TASK 3-4 — dev 성능 개선

package.json 수정:
"dev": "next dev --turbopack"

---------------------------------------

## STOP CONDITIONS

STOP if:
- key rotation 안됨
- Authorization null 존재
- pricing 하드코딩 남아있음
- localStorage token 존재

---------------------------------------

## OUTPUT FORMAT

FILES CHANGED:
ROOT CAUSE:
FIX:
VALIDATION:
NEXT STEP: