---
name: settlement-guard
description: NOX 정산 코드 (돈 계산) 작성/수정 시 server-side only · toNum 가드 · 종목단가 DB 조회 · % 계산 금지 · 열람 권한 규칙 강제
---

# Settlement Guard

정산 = **실제 돈**. 여기서 실수하면 사장/실장/아가씨 사이 분쟁 발생. 반드시 아래 규칙 준수.

## 절대 금지 (즉시 reject)

1. **클라이언트 정산 계산 금지**
   - 사용자 입력 금액을 신뢰해서 정산 확정 금지
   - `finalize`, `receipt` 는 항상 서버가 재계산 후 확정
   - offline queue 에서 finalize 시도 → `FORBIDDEN_OFFLINE_TYPES` 에서 차단

2. **% 기반 계산 전면 금지**
   - `total * 0.1` 같은 rate 계산 금지
   - **고정 금액만** 사용 (실장수익 0원 / 5천원 / 1만원)
   - 아가씨 지급액 = `종목단가 - 실장수익` (실장이 명시 입력)

3. **종목단가 하드코딩 금지**
   - `lib/session/services/pricingLookup.ts` 사용
   - DB (`store_service_types` 테이블) 미조회 시 `PricingLookupError` throw
   - fallback 금액 (3만원/0원 등) 복구 금지

4. **`toNum()` 가드 제거 금지**
   - `lib/settlement/services/calculateSettlement.ts`
   - NUMERIC string / null / NaN 안전 처리. 제거하면 정산 폭발.

## 열람 권한 (owner-visibility skill 참조)

- 사장 응답에서 다음 필드 **개별 노출 금지**:
  - `manager_payout_amount` — 실장 개별 수익
  - `hostess_payout_amount` — 아가씨 개별 수익
- 사장이 볼 수 있는 것: TC 건수 · 총매출 · 사장마진 · 양주 · 웨이터봉사비 · 사입
- `lib/settlement/services/ownerVisibility.ts` 의 `resolveOwnerVisibility()` 통해 per-manager toggle 반영

## 정산 상태 machine

- `draft` (editable) → `finalized` (immutable)
- **재계산 시 new version 생성** — 절대 overwrite 안 함
- `archived_at` 스탬프 = 인쇄 완료 (migration 085). 이후 hard delete 아님 (세법 5년 보관)

## 타매장 정산 분기 (cross-store-guard 참조)

- `origin_store_uuid` 기준으로 처리
- 워킹매장은 장소만 제공, 수수료 없음

## 선정산 (pre-settlement) 규칙

- **60초 idempotency window** — 중복 요청 차단 (R28)
- audit: 요청자 + 실행자 **양쪽** 기록 필수

## 검증 스위트

- `lib/settlement/services/__tests__/` — 14 시나리오 고정
- `npm test` 통과 필수 (정산 로직 수정 시)

## 체크리스트

- [ ] server-side 계산인가 (client 입력 무시)
- [ ] 종목단가 DB 조회 (하드코딩 아님)
- [ ] % 계산 없음 (고정 금액만)
- [ ] `toNum()` 가드 유지
- [ ] owner 응답에서 개별 payout 제거 (`ownerVisibility` 헬퍼)
- [ ] `cross_store` 인 경우 `origin_store_uuid` 기준
- [ ] audit_events insert (선정산 시 요청자+실행자)
- [ ] finalize 시 new version 생성 (overwrite 금지)
