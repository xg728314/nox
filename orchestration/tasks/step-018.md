[ROUND]
STEP-018

[TASK TYPE]
locked audit viewer task

[OBJECTIVE]
STEP-013B에서 audit_events는 이미 기록되고 있다.
하지만 현재는 “기록만 되고 볼 수 없는 상태”다.

이번 단계의 목표는:
1. audit log 조회 API 구현
2. owner 전용 audit viewer UI 구현
3. 지급/교차정산/보안 이벤트 추적 가능하게 만들기
4. 필터/검색/기간 조회 기능 추가
5. 운영/보안 사고 대응 가능 상태 만들기

이 단계는 조회 기능이며, audit write 구조 변경이 아니다.

---

[LOCKED RULES]

- 기존 audit_events write 구조 변경 금지
- payout / settlement / cross-store 로직 변경 금지
- 계산 로직 수정 금지
- store_uuid scope 유지
- resolveAuthContext 기반 접근 유지
- owner 외 접근 금지 (기본)
- 민감정보 노출 금지

---

# 1. REQUIRED API

## audit list

```text
GET /api/audit-events