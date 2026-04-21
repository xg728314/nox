# NOX BLE SPEC (LOCKED)

## 하드웨어 구조
- 게이트웨이: 하드웨어 장비 (펌웨어 탑재)
- 태그: 커스텀 BLE 태그 (beacon_minor로 식별)
- Android 앱 불필요

## 인증
- 헤더: x-gateway-key
- DB 검증: ble_gateways.gateway_secret

## 게이트웨이 → 서버 전송
- endpoint: POST /api/ble/ingest
- 형식:
  {
    "gateway_id": "gw-xxx",
    "events": [
      {
        "beacon_minor": 123,
        "event_type": "enter",
        "rssi": -62,
        "observed_at": "2026-04-10T12:34:56.000Z"
      }
    ]
  }
- event_type: enter / leave / heartbeat

## 태그 식별
- beacon_minor → ble_tags → hostess 매핑
- store_uuid + minor 기준

## DB 테이블
- ble_gateways: 게이트웨이 등록/인증
- ble_tags: 태그 → 아가씨 매핑
- ble_ingest_events: raw 이벤트 저장
- ble_tag_presence: 현재 위치 상태

## 세션 연동
- enter 이벤트 → 아가씨 세션 참여 가능
- leave 이벤트 → 아가씨 퇴실 처리
- BLE는 보조 신호 (정산 확정 트리거 불가)
