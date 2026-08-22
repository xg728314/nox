---
name: file-scope-lock
description: NOX 파일 수정 전 protected 영역 확인 · docs/orchestration/LOCKED 파일 리스트 · wind read-only 규칙
---

# File Scope Lock

수정하기 전 이 파일이 LOCKED / protected 인지 확인.

## LOCKED 파일 (orchestration 승인 없이 수정 금지)

### 문서
- `docs/**` — **전부 LOCKED**. 오케스트레이터 (ChatGPT) 만 수정 가능.
- `orchestration/config/**` — 수정 금지

### 외부 참조
- `C:\work\wind` — **read-only 참조만 허용** (게이트웨이/태그 이식 검토용)
  - import 금지, 코드 복사·실행 금지
  - Bash `ls C:/work/wind/...` 등 조회는 OK

### Protected Calculation Invariants

- `lib/session/services/pricingLookup.ts` — DB 미조회 시 PricingLookupError. fallback 금액 복구 금지.
- `lib/settlement/services/calculateSettlement.ts` — `toNum()` 가드 제거 금지.
- `app/api/sessions/checkin/route.ts` + `app/api/sessions/[session_id]/route.ts` — manager_membership_id 검증 제거 금지.

### Protected Areas (전체 도메인)

수정 시 반드시 명시 승인:
- Authentication / Authorization 로직 (`lib/auth/*`)
- Settlement core calculation (`lib/settlement/services/*`)
- Session core lifecycle (`app/api/sessions/checkin`, `checkout` 등)
- Database schema (migration 이미 apply 된 것 revert 금지)
- Business date 로직 (`lib/time/businessDate.ts`)

### 5F 완료 LOCKED (CLAUDE.md 하단 리스트)

CLAUDE.md `LOCKED - 5층 전체 완료 (2026-04-12)` 섹션의 파일들 (~40개).
검증 완료. 수정 시 반드시 orchestration 승인.

주요:
- `app/api/auth/*`, `app/api/sessions/*`, `app/api/store/*`
- `app/counter/**`, `app/settlement/**`, `app/manager/**`, `app/owner/**`
- `lib/auth/resolveAuthContext.ts`
- `lib/offline/sync.ts`
- `database/003_credits.sql` ~ `009_cross_store_settlement.sql`

## 수정 승인 요청 flow

1. 파일이 LOCKED 인지 CLAUDE.md 하단 리스트 검색
2. LOCKED 이면 사용자에게 명시 승인 요청
3. 승인 후에도 최소 diff 로 수정 (전체 rewrite 금지)
4. 커밋 메시지에 "LOCKED area 승인 후 수정" 기록

## 자주 하는 실수

- ❌ "리팩터 김에 lib/auth 도 정리" — 승인 없이 protected area 건드림
- ❌ `docs/**` markdown 오타 발견 → 그냥 고침 — LOCKED 위반
- ❌ `C:\work\wind` 에서 유틸 하나 복사 — 규칙 위반 (read-only 참조만)

## 체크리스트

- [ ] 수정하려는 파일이 CLAUDE.md LOCKED 리스트에 있는가
- [ ] Protected area (auth/settlement/session core/schema/business-date) 인가
- [ ] `docs/**` / `orchestration/config/**` 인가
- [ ] `C:\work\wind` 코드를 참조 이상으로 사용하려는가
- [ ] LOCKED 이면 명시 승인 받았는가
