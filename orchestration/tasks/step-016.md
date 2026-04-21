[ROUND]
STEP-016

[TASK TYPE]
locked reporting & analytics task

[OBJECTIVE]
STEP-015까지 완료되었고,
정산/지급/보안/UX까지 대부분 완성된 상태다.

이번 단계의 목표는:
1. 운영자가 한눈에 볼 수 있는 리포트 제공
2. 매출 / 정산 / 미지급 / 교차정산 현황 집계
3. business_day 기준 집계 구조 유지
4. 계산 로직 재구현 없이 저장된 데이터 기반 집계

이 단계는 "조회/리포트"이며 계산 엔진 변경이 아니다.

---

[LOCKED RULES]

- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 로직 변경 금지
- UI에서 금액 계산 금지
- 모든 수치는 DB에 저장된 값 집계만 사용
- store_uuid scope 유지
- resolveAuthContext 기반 접근 유지
- legacy route 사용 금지

---

# 1. REPORT TARGETS

## 1. 매출 요약 (store-level)

필수:

- 총 매출 (store revenue)
- 총 수익 (store profit)
- 총 지급 금액 (hostess + manager)
- 미지급 금액 (remaining)

---

## 2. 실장 리포트

필수:

- 실장별 총 정산 금액
- 지급 완료 금액
- 미지급 금액
- 담당 아가씨 수

정렬:
- 미지급 내림차순 기본

---

## 3. 아가씨 리포트

필수:

- 아가씨별 총 수익
- 지급 완료 금액
- 미지급 금액
- 상태 (confirmed / partial / paid)

---

## 4. 교차정산 리포트

필수:

- 가게별 정산 금액
- 지급 완료 금액
- remaining
- 상태 (open / partial / completed)

---

## 5. 최근 활동

필수:

- 최근 payout 20건
- 최근 cross-store payout
- 최근 cancel (STEP-014 이후)

---

# 2. REQUIRED API

가능하면 아래 API 추가:

- GET /api/reports/overview
- GET /api/reports/managers
- GET /api/reports/hostesses
- GET /api/reports/cross-store
- GET /api/reports/activity

---

## API 규칙

- store_uuid 기준 필터
- role 기반 접근 제한
- soft delete 제외
- limit 적용 (무제한 금지)
- 정렬 기본값 명확히

---

# 3. AGGREGATION RULES

중요:

- settlement_items / payout_records / cross_store_* 테이블 기반 집계
- 새로운 계산식 만들지 말 것
- existing amount / paid / remaining 그대로 사용

예:

```text
total_paid = SUM(paid_amount)
total_remaining = SUM(remaining_amount)