# NOX — BLE MONITOR VALIDATION CHECKLIST

## [PURPOSE]

이 문서는 Claude Code가 생성한 구현 계획이
실제 개발 가능한 수준인지 검증하기 위한 체크리스트다.

모든 항목은 PASS / FAIL 로 판단한다.

---

## [CRITICAL LOCK CONDITIONS]

### MUST BE TRUE

* BREAKPOINT = 768px ONLY
* `/monitor` 라우터 존재
* cross_store_work_records 존재 확인 완료

---

## [SECTION 1 — DEVICE SPLIT]

### PASS 조건

* `/counter/monitor` 와 `/m/monitor` 완전히 분리됨
* `/monitor` → device 기준 redirect 동작
* mobile / ops UI 컴포넌트 공유 없음

### FAIL 조건

* 하나의 컴포넌트로 분기 처리
* Tailwind responsive 로 억지 분리
* renderMobile 같은 분기 남아있음

---

## [SECTION 2 — API STRUCTURE]

### PASS 조건

* `/api/monitor/scope` 존재
* 단일 query layer 사용
* `WHERE store_uuid IN (...)` 구조
* `/api/counter/monitor` 재호출 없음

### FAIL 조건

* 매장 수만큼 API 반복 호출
* Node에서 merge 중심 로직
* fan-out 구조 존재

---

## [SECTION 3 — PERFORMANCE]

### PASS 조건

* 쿼리 수 store 개수와 무관 (고정)
* BLE history 조건부 저장
* retention 정책 존재

### FAIL 조건

* heartbeat마다 history 저장
* store 수 증가 시 성능 선형 증가

---

## [SECTION 4 — MOBILE UX]

### PASS 조건

* 1차 메뉴: 내소속 / 5~8층
* 2차 메뉴: 매장 선택
* 한 화면 = 한 매장
* 하단 시트 기반 액션 구조

### FAIL 조건

* 전체 층 한 화면 표시
* PC UI 축소 사용
* 지도 + 패널 혼합 구조

---

## [SECTION 5 — LOCATION VISIBILITY]

### PASS 조건

* mine scope = 내소속 + 타가게 근무중 포함
* 근무 종료 시 즉시 제거

### FAIL 조건

* 내 가게만 표시
* 타가게 근무 상태 반영 안됨

---

## [SECTION 6 — CORRECTION SYSTEM]

### PASS 조건

* POST `/api/location/correct` 존재
* correction log 저장
* overlay + log 동시 기록
* 즉시 UI 반영 (setState + refresh)

### FAIL 조건

* 로그 저장 없음
* 수정 후 7초 polling 기다림
* UI 즉시 반영 없음

---

## [SECTION 7 — CORRECTION DEDUP]

### PASS 조건

* 동일 대상 + 동일 위치 + 짧은 시간 중복 차단
* 서버 레벨에서 처리

### FAIL 조건

* 중복 저장 허용
* 동일 사용자 연속 제출 허용

---

## [SECTION 8 — BLE HISTORY]

### PASS 조건

* `ble_presence_history` 존재
* 조건부 저장 (변화 시만)
* 30일 retention 정책

### FAIL 조건

* heartbeat 전체 저장
* 무제한 증가
* 인덱스 없음

---

## [SECTION 9 — ADMIN ACCESS]

### PASS 조건

* `super_admin` role 기반 처리
* user_global_roles 사용
* 전체 매장 조회 가능

### FAIL 조건

* 이메일 하드코딩
* role 없이 권한 처리

---

## [SECTION 10 — DATA FLOW]

### PASS 조건

* scope → API → DB → UI 흐름 명확
* correction → 즉시 반영 → 로그 기록

### FAIL 조건

* 흐름 불명확
* API / UI 연결 안됨

---

## [SECTION 11 — QUERY STRATEGY]

### PASS 조건

* 단일 DB query layer
* IN 조건 기반
* 9개 이하 쿼리 구조

### FAIL 조건

* 반복 API 호출
* store loop 구조
* join 대신 반복 fetch

---

## [FINAL RESULT]

### PASS 기준

* 모든 SECTION PASS
* CRITICAL LOCK 조건 충족

### FAIL 기준

* 하나라도 FAIL 발생 시 재설계 필요

---

## [USAGE]

Claude Code 결과를 받은 후
이 체크리스트 기준으로 검증할 것.

PASS 확인 후에만 실제 개발 진행.

---

## [IMPORTANT]

이 체크리스트를 통과하지 못하면:

* 성능 문제 발생
* 데이터 불일치 발생
* 모바일 UX 붕괴
* 운영 불가능 상태 발생

반드시 검증 후 진행할 것.
