---
name: ble-nfc-privacy
description: NOX BLE 게이트웨이 / NFC 태그 코드 작성 시 HMAC 검증 · presence confidence · 익명 이벤트 원칙 규칙
---

# BLE & NFC Privacy

BLE = 아가씨 출근 자동 감지. NFC = 방/서비스 이벤트 트리거.
**공통 원칙**: 프라이버시 최우선 · 익명 이벤트만.

## BLE 게이트웨이

### HMAC 검증 (P0 hardening)

- `lib/ble/hmac.ts`
- Signature = `HMAC_SHA256(raw_request_body, gateway_secret)` as hex
- 서버가 `ble_gateways.gateway_secret` 로 재계산 후 constant-time 비교
- 검증 실패 → DB write 전 즉시 reject

### Presence Confidence

- `lib/ble/computePresenceConfidence.ts`
- RSSI + duration + 게이트웨이 신뢰도 종합
- Confidence 낮으면 자동 등록 안 함 (수동 확인)

### Correction Guard

- `lib/ble/correctionGuard.ts`
- 위치 correction 은 감사 로그 남김 (`location_correction_logs`)

### Rate Limit

- `lib/ble/rateLimit.ts`
- 게이트웨이 spam 방지

### Cron

- `ble-attendance-sync` (5분) — presence → attendance 반영
- `ble-session-inference` (5분) — 세션 추론
- `ble-history-reaper` (일 1회) — 오래된 raw ping 정리

## NFC 태그

### 원칙: 익명 이벤트만

- **아가씨 앱 강제 안 함** (privacy 이슈로 R28 방향 결정)
- 태그 tap = 익명 이벤트 (`nfc_events` 테이블)
- 이후 실장/카운터가 이벤트 소스와 대상 매칭

### 태그 종류

- `room` — 방 지정
- `waiter_call` — 웨이터 호출
- `purchase` — 사입 이벤트
- `toilet` — 화장실 이벤트
- `manager_call` — 실장 호출

### 자주 하는 실수

- ❌ NFC 이벤트에 hostess_membership_id 를 자동 기록 → privacy 위반
- ❌ BLE HMAC 검증 우회 (dev 편의) → 프로덕션 배포 시 위험
- ❌ Presence confidence 낮은데 자동 등록 → 오분류 발생
- ❌ Location correction 감사 로그 안 남김 → 사고 시 원인 추적 불가

## 참조 자료

- `C:\work\wind` — 게이트웨이/태그 코드 참조 허용 (read-only)
- import 금지 · 코드 복사 금지 (file-scope-lock 참조)

## 체크리스트

- [ ] BLE ingest HMAC 검증 통과
- [ ] Presence confidence 기준 통과 후에만 자동 등록
- [ ] Location correction 감사 로그 필수
- [ ] NFC 이벤트는 anonymous (hostess_id 자동 매칭 금지)
- [ ] Rate limit 준수 (gateway 게이트당)
- [ ] Cron heartbeat 스탬프 (cron-endpoint 참조)
