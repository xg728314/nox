# NOX — MOBILE BLE MONITOR STRUCTURE (EXECUTION TASK)

## [TASK TYPE]

ARCHITECTURE + UI + API DESIGN

---

## [OBJECTIVE]

현재 NOX 시스템은
단일 매장 기반 BLE 모니터 구조로 되어 있다.

이를 아래 요구사항에 맞게 확장한다:

* 모바일 환경 최적화
* 층(5~8F) + 매장 선택 구조
* 내소속 / 전체층 탐색
* 위치 오류 수정 + 검수 로그 기록
* 운영자 전매장 조회 가능

---

## [CORE REQUIREMENTS]

### 1. MOBILE NAVIGATION STRUCTURE

#### 1차 메뉴 (항상 표시)

* 내소속
* 5층
* 6층
* 7층
* 8층

#### 2차 메뉴 (층 선택 시)

* 해당 층 매장 목록
  예: 5층 → 마블 / 라이브 / 버닝 / 황진이

---

### 2. MINI MAP RULE

* 한 화면에 한 매장만 표시
* 방 / 화장실 / 엘리베이터 표시
* 아가씨 위치 표시
* 상태 표시:

  * 내 가게
  * 타 가게 근무 중
  * 이탈

---

### 3. LOCATION VISIBILITY RULE

* 내 가게 아가씨가 타 가게에서 근무 중일 경우 → 표시
* 근무 종료 시 → 즉시 비표시
* 운영자는 전체 조회 가능

---

### 4. LOCATION CORRECTION FLOW

1. 아가씨 클릭
2. 위치 오류 선택
3. 실제 위치 선택 (층 → 매장 → 방)
4. 오류 유형 선택
5. 저장

---

### 5. CORRECTION LOG SYSTEM

table: location_correction_logs

필수 저장:

* 대상 아가씨
* 기존 위치
* 수정 위치
* 검수자 (user_id / email / nickname)
* 오류 유형
* 시간

---

### 6. MOBILE UI STRUCTURE

순서:

1. 미니맵
2. 실시간 위치 현황
3. 이탈 알림
4. 최근 이동 이벤트
5. (운영자) 층 요약

---

### 7. ACTION SHEET (모바일)

아가씨 클릭 시:

* 현재 위치 보기
* 위치 오류 수정
* 이동 기록 보기

---

### 8. ADMIN ACCESS

운영자:

* [xg72314@gmail.com](mailto:xg72314@gmail.com)

권한:

* 전체 층 조회
* 전체 매장 조회
* 전체 위치 로그 조회

---

### 9. CURRENT SYSTEM LIMITATIONS (분석 기반)

반드시 해결할 것:

* 단일 store_uuid 기반 API 구조
* 5~8층 고정 템플릿 레이아웃
* multi-store 동시 조회 불가
* BLE 데이터는 snapshot only
* 모바일 UI 없음

---

## [REQUIRED OUTPUT FORMAT]

1. FILES TO CREATE
2. FILES TO MODIFY
3. DB SCHEMA
4. API DESIGN
5. UI COMPONENT STRUCTURE
6. ACCESS CONTROL
7. DATA FLOW
8. MIGRATION PLAN

---

## [CONSTRAINTS]

* 추측 금지
* 현재 코드 기준으로 분석
* 기존 기능 깨지면 실패
* 단계별 적용 가능 구조로 설계

---

## [FAIL IF]

* 단일 매장 구조 유지
* 모바일 고려 안함
* 위치 오류 로그 누락
* 운영자 전매장 조회 불가
* UI만 바꾸고 데이터 구조 안 바꿈

---

## [STOP CONDITIONS]

* 전체 구조 설계 완료
* 수정 대상 파일 명확
* DB/API/UI 연결 구조 명확

---

## [IMPORTANT]

이 작업은 단순 UI 변경이 아니다.

"건물 전체 BLE 관제 시스템 확장 작업"이다.

현재 구조를 유지하면서 확장 가능한 방식으로 설계해야 한다.
