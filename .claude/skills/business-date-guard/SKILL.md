---
name: business-date-guard
description: NOX 날짜/시간 로직 작성 시 business_date (KST) 사용 · calendar date/created_at aggregation 금지 · UTC 버그 회피
---

# Business Date Guard

유흥업소는 자정 넘어서 영업. 카운터 시각은 KST. 이 도메인에서 `Date.now()` / UTC 는 함정.

## 핵심 규칙

1. **모든 aggregation 은 `business_date` 기준**
   - 매출, 세션 카운트, 정산, 리포트 전부
   - `created_at` 이나 calendar date 로 GROUP 금지
   - 예: 23:00 시작 → 02:00 종료 세션 = `business_date = 시작일`

2. **KST 기준 헬퍼 사용**
   - `lib/time/businessDate.ts`
   - 절대 로컬 `new Date()` 만으로 판단하지 말 것

3. **`business_date_id` (또는 `business_day_id`) canonical**
   - `store_operating_days` 테이블 참조
   - date string ("2026-08-22") 대신 이 ID 로 join

## R28 UTC 버그 이력

- 서버가 UTC 로 도는데 date 만들 때 UTC 기준 → KST 새벽 시간대 오차
- Fix: `lib/time/businessDate.ts` 헬퍼 통일 · 18 파일 sweep 완료
- **재발 방지**: 새 date 로직 만들 때 이 헬퍼 재사용

## 서버 시각 vs 카운터 PC 시각

- 카운터 PC 시계 어긋날 수 있음 (배터리 방전 등)
- Fix: `/api/system/time` endpoint + `lib/time/serverClock.ts`
  - `useServerClock()` — client hook, server 와 offset 보정
  - `getServerNow()` — server-adjusted `Date`
- **UI 초 단위 표시** (checkout timer 등) 는 이 hook 사용
- **정산 금액**은 server-side 계산이라 무관

## 자주 하는 실수

- ❌ `WHERE created_at::date = '2026-08-22'` → business_date 아님
- ❌ `new Date().toISOString().split('T')[0]` → UTC 기준
- ❌ `Date.now()` 로 timer 표시 → 카운터 PC 시각 오차
- ❌ Cron endpoint 안에서 `Date.now()` 로 KST 판단 → UTC 서버 실행이라 오차

## 정확한 KST date string 얻기

```typescript
import { getBusinessDate } from "@/lib/time/businessDate"

const bd = getBusinessDate(new Date()) // 자정 전이면 오늘, 자정~새벽이면 어제
```

## 체크리스트

- [ ] `business_date` / `business_day_id` 로 aggregation 하는가
- [ ] KST 헬퍼 사용 (`lib/time/businessDate.ts`)
- [ ] client 표시 timer 는 `useServerClock` 사용
- [ ] Cron 로직 안에 `Date.now()` 직접 사용 없음
- [ ] `store_operating_days` 잠금 상태 확인 (영업일 마감 후 수정 금지)

## 참고

- 잔여 156곳 client `Date.now()` 남아있음 (다음 라운드 sweep 예정)
- CLAUDE.md Known Gap #12 참조
