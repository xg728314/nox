---
name: owner-visibility
description: NOX owner API 응답 작성 시 manager/hostess 개별 payout 노출 금지 · resolveOwnerVisibility 헬퍼 사용 · TC 개별 단가 분해 금지 규칙
---

# Owner Visibility

사장은 **큰 그림만** 봄. 실장 개별수익 · 아가씨 개별수익 은 원칙적으로 비노출.

## 사장이 볼 수 있는 것

- 양주판매내역 (총액)
- 웨이터봉사비
- 사입
- **TC 건수** 와 **TC 총액**
- 총매출
- 사장마진

## 사장이 볼 수 없는 것 (기본값)

- ❌ 실장 개별 수익 (`manager_payout_amount`)
- ❌ 아가씨 개별 수익 (`hostess_payout_amount`)
- ❌ TC 개별 단가 분해 (건수/총액만)

## 예외: per-manager visibility toggle

- `lib/settlement/services/ownerVisibility.ts`
- 실장별로 자기 수익 사장에게 공개 여부 토글 설정 가능
- 헬퍼:
  ```typescript
  import { resolveOwnerVisibility } from "@/lib/settlement/services/ownerVisibility"
  const flags = await resolveOwnerVisibility(supabase, store_uuid)
  // flags = { showManager: boolean, showHostess: boolean }
  ```
- **30초 TTL cache** (R-Speed-x10) — receipt/finalize 마다 재조회 안 함

## per-row 마스킹 패턴

```typescript
const flags = await resolveOwnerVisibility(sb, auth.store_uuid)

const response = rows.map((r) => ({
  ...r,
  manager_payout_amount: flags.showManager ? r.manager_payout_amount : null,
  hostess_payout_amount: flags.showHostess ? r.hostess_payout_amount : null,
}))
```

## 자주 하는 실수

- ❌ owner route 에서 개별 payout 그대로 반환 (마스킹 안 함)
- ❌ 클라이언트 (`/owner/*` page) 에서 개별 필드 표시
- ❌ `resolveOwnerVisibility` 헬퍼 안 쓰고 매번 DB 조회 (RTT 낭비)
- ❌ TC 개별 단가 분해해서 사장에게 표시

## API route 적용 위치

- `app/api/owner/settlement/route.ts` (이미 적용)
- `app/api/store/settlement/overview/route.ts` (이미 적용)
- `app/api/sessions/settlement/*` — 사장 요청 시에만 마스킹
- 새 owner 응답 만들 때는 무조건 이 헬퍼 통과

## R28 완료 항목

- per-manager visibility 토글 UI: manager 본인이 토글
- per-row 마스킹: 헬퍼 통과 후 응답 생성
