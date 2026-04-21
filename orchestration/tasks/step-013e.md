[ROUND]
STEP-013E

[TASK TYPE]
locked authentication enforcement task

[OBJECTIVE]
STEP-013D까지 MFA, trusted device, reauth 구조는 구현되었지만
아직 “강제되지 않은 상태”이다.

이번 단계의 목표는:
1. MFA 로그인 강제 적용
2. trusted device 자동 등록
3. MFA brute-force 방어
4. 보안 흐름 완전 봉인

이 단계가 끝나면:
→ 계정 탈취 시도 / 무차별 OTP 공격 / 무단 기기 로그인 방어 완성

---

[LOCKED RULES]

- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 핵심 로직 변경 금지
- 기존 로그인 구조 유지하되 강제 정책만 추가
- 민감정보 평문 저장 금지
- MFA secret 절대 노출 금지

---

# 1. MFA 강제 로그인

현재:
- mfa_enabled 있어도 로그인 시 강제 안 함

변경:

```text
if mfa_enabled = true:
  → 로그인 시 반드시 OTP 요구