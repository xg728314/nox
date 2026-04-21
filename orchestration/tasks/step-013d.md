[ROUND]
STEP-013D

[TASK TYPE]
locked authentication security task

[OBJECTIVE]
이번 단계의 목표는 NOX 로그인 보안을 강화하는 것이다.

핵심 목표:
1. MFA(OTP 기반 2단계 인증) 구조 추가
2. 새 기기 로그인 감지
3. trusted device 관리
4. 중요 작업 재인증(reauth) 구조 추가
5. 기존 로그인 흐름을 가능한 한 보수적으로 확장

이 단계는 "보안 강화"이며, 정산 계산/지급 계산 기능 변경이 아니다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 핵심 계산 로직 변경 금지
- 기존 auth 구조를 완전히 갈아엎지 말 것
- 가능한 범위에서 additive 방식으로 구현
- store_uuid scope 규칙 유지
- resolveAuthContext와 충돌하지 않게 구성
- 민감정보는 raw 값 저장 금지
- OTP secret은 평문 저장 금지

[SECURITY TARGETS]

1. MFA (OTP)
- TOTP 기반 (Google Authenticator / Authy 호환)
- owner: 필수 적용 가능 구조
- manager: 필수 적용 가능 구조
- hostess: 선택 적용 가능 구조
- 초기 단계에서는 "지원 + 정책 강제 가능 상태"까지 구현

2. 새 기기 감지
- 로그인 성공 시 trusted device 여부 확인
- 새 기기이면 추가 인증 필요
- MFA 성공 후 trusted device 등록 가능

3. trusted device 관리
- user별 trusted device 저장
- revoke 가능 구조
- 마지막 사용 시각 기록

4. 중요 작업 재인증
최소 대상:
- payout 실행
- cross-store 생성
- cross-store payout
- 계좌 변경 (이미 API 있으면 연결 가능 구조)
재인증은 로그인 세션이 살아 있어도 다시 OTP 또는 최근 재인증 상태를 요구하는 구조여야 한다.

[REQUIRED DATA MODEL]

가능하면 아래 테이블/필드 추가:

1. user_mfa_settings (or equivalent)
- id
- user_id
- is_enabled
- secret_encrypted
- backup_codes_hashed nullable
- created_at
- updated_at
- deleted_at nullable

2. trusted_devices
- id
- user_id
- device_id
- device_name nullable
- user_agent_hash or safe fingerprint summary
- first_seen_at
- last_seen_at
- trusted_at
- revoked_at nullable
- created_at
- updated_at

3. reauth_challenges or equivalent session-backed structure
- id
- user_id
- challenge_type
- verified_at
- expires_at
- created_at

4. security_events (optional if audit_events is sufficient)
- if existing audit_events can cover auth/security safely, reuse it

[REQUIRED CHANGES]

A. MFA SETUP FLOW

필요 API 예시:
- POST /api/auth/mfa/setup
- POST /api/auth/mfa/verify
- POST /api/auth/mfa/enable
- POST /api/auth/mfa/disable

목표:
- setup 시 secret 생성
- QR 또는 otpauth URI 제공
- verify 시 OTP 검증
- enable 후 계정에 MFA 활성화

주의:
- secret raw 반환은 setup 단계에서만 최소 범위
- DB 저장은 encrypted/secured form
- logs/audit에 raw secret 금지

---

B. LOGIN FLOW EXTENSION

기존 로그인 route/flow 구조를 먼저 확인 후 보수적으로 확장.

로그인 목표 흐름:
1. id/password 1차 확인
2. trusted device 여부 판단
3. MFA required 여부 판단
4. 필요 시 mfa_required 상태 반환
5. OTP 성공 시 로그인 완료
6. trusted device 등록 선택 또는 자동 등록 정책 적용

필수:
- 새 기기면 MFA 요구 가능
- MFA enabled 계정은 정책에 따라 반드시 OTP 요구
- role 기반 정책 강제 가능해야 함 (owner/manager stronger)

---

C. TRUSTED DEVICE

필수:
- device_id는 서버가 검증 가능한 방식으로 다뤄야 함
- client가 준 임의 문자열만 그대로 신뢰 금지
- 최소한 signed cookie / session-bound identifier / hashed tuple 등 프로젝트 구조에 맞는 보수적 방법 선택

기능:
- 현재 기기 trusted 등록
- trusted device 목록 조회 (owner/self)
- revoke 가능

예시 API:
- GET /api/auth/devices
- POST /api/auth/devices/revoke

---

D. REAUTH FLOW

중요 작업 전에 재인증 가능 구조 추가.

예시 API:
- POST /api/auth/reauth/start
- POST /api/auth/reauth/verify

또는 더 단순한 구조여도 됨:
- POST /api/auth/reauth

필수:
- payout / cross-store write route에서 최근 재인증 여부 확인 가능해야 함
- 재인증 통과 후 짧은 TTL 부여 (예: 몇 분)
- TTL 만료 후 다시 요구

중요:
- 이번 단계에서는 반드시 아래 write 보호 구조를 넣을 것:
  1. POST /api/settlement/payout
  2. POST /api/cross-store
  3. POST /api/cross-store/payout

정책:
- owner / manager의 financial write는 reauth required 가능 상태로 만들 것
- hostess는 해당 write 자체가 금지되어 있으므로 reauth 대상 아님

---

E. POLICY LAYER

정책은 하드코딩 최소화, 하지만 명확해야 함.

최소 정책:
- owner: MFA 권장 또는 필수 적용 가능
- manager: MFA 권장 또는 필수 적용 가능
- hostess: 초기에는 선택
- financial write route: reauth required
- new device login: MFA required when enabled or role policy requires

가능하면 helper/config로 분리:
- requiresMfa(role)
- requiresReauth(action, role)
- isTrustedDevice(...)

---

F. AUDIT / SECURITY EVENT LOGGING

최소 기록:
- mfa_enabled
- mfa_disabled
- mfa_verification_failed
- new_device_detected
- trusted_device_added
- trusted_device_revoked
- reauth_success
- reauth_failed
- sensitive_action_blocked_due_to_missing_reauth

민감정보 저장 금지:
- raw OTP secret
- raw OTP code
- raw backup code
- full fingerprint raw dump

---

G. UI / PAGES

가능하면 최소 화면 추가:
- MFA 설정 페이지
- OTP 입력 페이지 or modal
- trusted devices 목록
- reauth prompt modal or page

주의:
- UI는 thin 하게
- 실제 보안 강제는 서버에서 해야 함
- UI 숨김/표시만으로 보안 처리 금지

---

H. BACKWARD COMPATIBILITY

- 기존 로그인 사용자 전체를 즉시 막지 말 것
- additive rollout 우선
- migration/backfill 보수적으로
- MFA 미설정 사용자는 기존 로그인 가능하되, 정책 role에는 setup 유도 또는 강제 가능 구조로 구현

[VALIDATION REQUIREMENTS]

반드시 확인:
1. MFA secret 평문 DB 저장 없음
2. MFA setup / verify / enable 동작
3. MFA enabled 계정 로그인 시 OTP 요구 동작
4. 새 기기 감지 시 추가 인증 동작
5. trusted device 등록/조회/해제 동작
6. financial write route에서 reauth 미충족 시 차단
7. reauth 후 payout/cross-store write 가능
8. audit/security event 기록 생성
9. tsc --noEmit 통과
10. 기존 settlement/cross-store core 로직 변경 없음

[FAIL IF]
- OTP secret 평문 저장
- client device_id를 그대로 신뢰
- 서버 강제 없이 UI로만 MFA 처리
- reauth 없이 payout/cross-store write 가능 상태 유지
- 기존 로그인 전체가 불필요하게 깨짐
- 계산 로직 수정
- settlement core 변경
- 민감정보 로그 저장

[OUTPUT FORMAT]
1. FILES CHANGED
2. MFA / DEVICE MODEL
3. API ADDED / UPDATED
4. LOGIN / REAUTH FLOW
5. SECURITY LOGGING
6. VALIDATION
7. RISKS / FOLLOW-UPS