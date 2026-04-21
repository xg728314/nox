[ROUND]
STEP-017

[TASK TYPE]
locked closing control task

[OBJECTIVE]
현재 NOX는 정산/지급/리포트까지 완료된 상태다.
하지만 "마감(closing)" 개념이 완전히 연결되지 않았다.

이번 단계의 목표는:
1. business_day 기준 마감 시스템 구축
2. 마감 이후 데이터 수정 차단
3. closing snapshot 저장
4. 정산 / 리포트 / payout과 연결
5. 운영 통제 완성

이 단계는 “운영 통제”이며 계산 로직 변경이 아니다.

---

[LOCKED RULES]

- business_day 규칙 유지 (수동 closing 기준)
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 로직 변경 금지
- 마감 이후 데이터 변경 차단 필수
- store_uuid scope 유지
- resolveAuthContext 기반 접근 유지

---

# 1. BUSINESS DAY RULE (중요)

현재 규칙 유지:

```text
하루는 자동 종료되지 않는다.
사용자가 closing 버튼을 눌러야 종료된다.