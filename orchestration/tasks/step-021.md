[ROUND]
STEP-021

[TASK TYPE]
final hardening & production readiness task

[OBJECTIVE]
STEP-020까지 완료된 상태에서 NOX는 기능적으로 완성되었다.
이번 단계의 목표는 “운영 투입 직전 최종 봉인”이다.

핵심 목표:
1. cross-store closing 정책 확정 및 적용
2. closing / reopen에 reauth 적용
3. audit API 구조 통합
4. 운영 안정성 최종 보완
5. production ready 상태 확정

이 단계 이후:
→ 즉시 실운영 투입 가능 상태

---

[LOCKED RULES]

- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 계산 로직 변경 금지
- 기존 API contract 유지
- store_uuid scope 유지
- resolveAuthContext 기반 구조 유지
- audit write 구조 유지 (통합만 가능)

---

# 1. CROSS-STORE CLOSING POLICY (필수)

정책 결정:

```text
cross-store payout은 closing 이후 금지