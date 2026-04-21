# NOX — PC/TABLET + MOBILE BLE MONITOR EXTENSION (FINAL TASK)

## [TASK TYPE]

ARCHITECTURE + DB + API + UI DESIGN

---

## [OBJECTIVE]

현재 NOX BLE 모니터 구조는 단일 매장 중심이다.

이를 아래 요구사항에 맞게 확장한다:

1. **PC / TABLET 모드**

* 전체 관제 화면
* 여러 매장/층을 한눈에 보기
* 운영/통제/오류 발견 중심

2. **MOBILE 모드**

* 탐색형 화면
* 층 → 매장 → 상세 미니맵
* 빠른 확인 / 빠른 수정 / 현장 대응 중심

3. **위치 오류 수정 + 검수 로그 기록**

* 누가 어떤 오류를 언제 수정했는지 기록
* 운영자가 검수자별 활동 로그 조회 가능

4. **운영자 전매장 조회**

* super_admin 은 5층~8층 전체 / 모든 매장 조회 가능

---

## [ABSOLUTE REQUIREMENTS]

### A. DEVICE SPLIT (MANDATORY)

하나의 UI를 축소/확대해서 쓰는 방식 금지.

반드시 2개 모드로 분리할 것:

#### Desktop / Tablet

* width >= 768px
* `/counter/monitor` 계열
* 전체 관제판
* 다중 매장 / 다중 층 시야
* 좌/중앙/우 패널 구조 가능

#### Mobile

* width < 768px
* `/m/monitor` 계열
* 탐색형 UI
* 한 화면 한 매장
* 하단 시트 / 카드 중심

### IMPORTANT

* PC UI를 축소해서 모바일에 쓰는 것 금지
* 모바일 UI를 늘려서 PC에 쓰는 것 금지
* 레이아웃 트리를 분리할 것
* 공유 가능한 것은 데이터 훅/로직만 허용
* 레이아웃/페이지/상호작용은 분리

---

## [PC / TABLET MODE REQUIREMENTS]

### 목적

* 전체 운영 관제
* 층별 / 매장별 상황 파악
* 오류 발견
* 이동 동선 확인

### 화면 구조

* 좌측: 룸/매장 리스트
* 중앙: 대형 미니맵 / 층 전체 구조
* 우측: 실시간 위치 / 이탈 / 요약 / 경고
* 필요 시 하단: 최근 이동 이벤트

### 표시 요구

* 5층 / 6층 / 7층 / 8층 구조 지원
* 여러 매장을 동시에 볼 수 있어야 함
* 이동 동선 표시 가능
* 운영자는 전체 매장 조회 가능

---

## [MOBILE MODE REQUIREMENTS]

### 목적

* 현장 대응
* 빠른 위치 확인
* 빠른 오류 수정

### 모바일 1차 메뉴 (항상 표시)

* 내소속
* 5층
* 6층
* 7층
* 8층

### 모바일 2차 메뉴 (층 선택 시)

해당 층의 매장 목록 표시
예:

* 5층 → 마블 / 라이브 / 버닝 / 황진이

### 모바일 핵심 규칙

* 한 화면에 한 매장만 표시
* 미니맵을 가장 크게 배치
* 나머지 정보는 아래 카드/시트로 분리

### 모바일 화면 순서

1. 미니맵
2. 실시간 위치 현황
3. 이탈 알림
4. 최근 이동 이벤트
5. (super_admin only) 층 요약

### 모바일 액션 시트

아가씨 클릭 시:

* 현재 위치 보기
* 위치 오류 수정
* 이동 기록 보기

### 모바일 UX 추가 규칙

* 선택된 층 강조
* 선택된 매장 강조
* 마지막 선택 층/매장 상태 저장
* 오조작 방지를 위해 수정은 2단계 이상으로 진행

---

## [LOCATION VISIBILITY RULES]

### 내소속 보기 (mine scope)

반드시 아래를 포함해야 한다:

1. 내 매장 소속 인원
2. **타 가게에서 현재 근무 중인 내 매장 소속 인원**

즉 mine scope 에서는

* own store workers
* AND own workers currently working in other stores (`working_store_uuid`)
  를 포함해야 한다

### 종료 규칙

* 타 가게 근무가 종료되면 즉시 비표시
* 과거 이력만 남고 실시간 목록에서는 제거

### 운영자

* super_admin 은 전체 층 / 전체 매장 / 전체 인원 조회 가능

---

## [LOCATION CORRECTION FLOW]

### 필수 플로우

1. 아가씨 클릭
2. 위치 오류 선택
3. 실제 위치 선택

   * 층
   * 매장
   * 방 또는 zone
4. 오류 유형 선택
5. 저장

### 저장 시 반드시 남겨야 할 것

* 대상 아가씨
* 시스템이 판단한 기존 위치
* 실제 수정 위치
* 검수자 정보
* 오류 유형
* 시간
* 메모(optional)

### 즉시 반영 규칙

POST `/api/location/correct` 성공 후

* 모니터 데이터 강제 새로고침
  또는
* 로컬 상태 즉시 갱신

**사용자는 7초 polling 지연 없이 수정 결과를 즉시 봐야 한다**

---

## [CORRECTION LOG SYSTEM]

### 목적

자동 보상 계산이 아니다.
운영자가 직접 아래를 볼 수 있어야 한다:

* 어떤 아이디가
* 언제
* 누구 위치를
* 어떻게 수정했는지
* 몇 건을 했는지

### 예시

* ao11 이 2026-04-21 에 8건 수정
* ao11 이 2026-04-22 에 5건 수정

### table

`location_correction_logs`

### 필수 저장 컬럼

* target_membership_id

* target_hostess_id

* target_name

* detected_floor

* detected_store_uuid

* detected_store_name

* detected_room_uuid

* detected_room_no

* detected_zone

* detected_at

* corrected_floor

* corrected_store_uuid

* corrected_store_name

* corrected_room_uuid

* corrected_room_no

* corrected_zone

* corrected_at

* corrected_by_user_id

* corrected_by_email

* corrected_by_nickname

* corrected_by_role

* corrected_by_store_uuid

* corrected_by_store_name

* error_type

* correction_note

* created_at

### error_type allowed values

* ROOM_MISMATCH
* STORE_MISMATCH
* HALLWAY_DRIFT
* ELEVATOR_ZONE
* MANUAL_INPUT_ERROR

### log table rules

* append-only
* UPDATE / DELETE 금지
* 인덱스는 user/date/store/floor 기준으로 설계

---

## [BLE HISTORY REQUIREMENT]

현재 BLE snapshot-only 구조 한계를 해결해야 한다.

최신 상태만 있는 구조로는:

* 이동 기록
* trail
* 과거 위치 검증
  이 부족하다.

### 신규 필요

`ble_presence_history`

### 목적

* BLE 원시 위치 시간축 기록
* 특정 membership 의 최근 이동 기록 조회
* correction log 와 함께 검수 근거 제공

### 요구

* ingest 시 history append
* source 구분 (`ble` / `corrected`)
* membership_id + time 인덱스 필수

---

## [ADMIN / SUPER ADMIN ACCESS]

### IMPORTANT

이메일 하드코딩을 권한 로직의 최종 수단으로 쓰지 말 것.

### 원칙

* `user_global_roles`
* `role = super_admin`
* `status = approved`

기반으로 처리할 것.

### 요구사항

운영자 계정은 전체 층 / 전체 매장 조회 가능해야 한다.

### 주의

특정 이메일 문자열은 grant migration 에서만 안전하게 처리하고,
앱 코드에서는 `auth.is_super_admin` 기준으로 동작할 것.

---

## [API REQUIREMENTS]

### IMPORTANT PERFORMANCE RULE

`/api/monitor/scope` 는
**기존 `/api/counter/monitor` 를 매장 수만큼 여러 번 호출하는 방식 금지**

### 반드시 이렇게 할 것

* 단일 DB query layer 사용
* `WHERE store_uuid IN (...)`
* 집계/병합은 가능한 한 DB 단계에서 수행
* Node 레벨에서 N회 API fan-out 금지

### 신규 API

#### 1. GET `/api/monitor/scope`

query:

* `scope = mine | current_floor | floor-5 | floor-6 | floor-7 | floor-8 | store-<uuid>`

역할:

* 스코프 기반 모니터 read

요구:

* 단일 쿼리 계층
* multi-store 대응
* super_admin / 일반 사용자 접근 규칙 반영

---

#### 2. GET `/api/monitor/stores?floor=N`

역할:

* 층 선택 후 매장 목록 제공
* 모바일 2차 메뉴 소스

응답 예:

* store_uuid
* store_name
* is_mine
* active_sessions
* total_rooms

---

#### 3. GET `/api/monitor/movement/[membership_id]`

역할:

* 특정 인원의 최근 이동 기록
* action sheet 의 “이동 기록 보기” 데이터 소스

소스:

* ble_presence_history
* business event 필요 시 병합

---

#### 4. POST `/api/location/correct`

역할:

* overlay correction
* correction log 저장
* 성공 후 UI 즉시 반영 가능해야 함

---

#### 5. GET `/api/location/corrections/by-user`

역할:

* 특정 유저 기준 검수 로그 조회

필터:

* user_id or nickname
* start_date
* end_date

---

#### 6. GET `/api/location/corrections/daily-summary`

역할:

* 날짜별 검수 요약

응답 예:

* date
* total
* ROOM_MISMATCH count
* STORE_MISMATCH count
* HALLWAY_DRIFT count
* ELEVATOR_ZONE count
* MANUAL_INPUT_ERROR count

---

#### 7. GET `/api/location/corrections/overview`

역할:

* super_admin 전용 전체 요약
* by_store / by_floor / by_reviewer

---

## [FILES TO CREATE]

### Database

* `database/054_location_correction_logs.sql`
* `database/055_grant_super_admin.sql`
* `database/056_ble_presence_history.sql`

### Libraries

* `lib/location/errorTypes.ts`
* `lib/location/correctionWrite.ts`
* `lib/monitor/scopeResolver.ts`
* `lib/monitor/mergeSnapshots.ts`
  단, merge 는 API fan-out 방식이 아니라 단일 query 결과를 shape 정리하는 용도로만 제한

### New API

* `app/api/monitor/scope/route.ts`
* `app/api/monitor/stores/route.ts`
* `app/api/monitor/movement/[membership_id]/route.ts`
* `app/api/location/correct/route.ts`
* `app/api/location/corrections/by-user/route.ts`
* `app/api/location/corrections/daily-summary/route.ts`
* `app/api/location/corrections/overview/route.ts`

### Mobile UI

* `app/m/layout.tsx`
* `app/m/monitor/page.tsx`
* `app/m/monitor/store/[store_uuid]/page.tsx`
* `app/m/monitor/components/MobileTopTabs.tsx`
* `app/m/monitor/components/StoreListSheet.tsx`
* `app/m/monitor/components/MobileMiniMap.tsx`
* `app/m/monitor/components/MobileHostessActionSheet.tsx`
* `app/m/monitor/components/LocationCorrectionSheet.tsx`
* `app/m/monitor/components/MovementHistorySheet.tsx`
* `app/m/monitor/components/FloorSummaryCard.tsx`

### Admin UI

* `app/super-admin/location-corrections/page.tsx`
* `app/admin/location-corrections/page.tsx`

---

## [FILES TO MODIFY]

* `app/counter/monitor/components/BleCorrectionModal.tsx`
* `app/counter/components/CounterBleMinimapWidget.tsx`
* `app/counter/monitor/hooks/useMonitorData.ts` (필요 시 scope-aware 확장)
* `app/super-admin/page.tsx`
* `middleware.ts`
* `app/api/ble/ingest/route.ts` (history append)

---

## [DO NOT BREAK / DO NOT REMOVE]

아래는 하위호환 유지:

* 기존 `/api/counter/monitor`
* 기존 `/api/ble/corrections`
* 기존 `/counter/monitor`
* 기존 `FloorMap.tsx`
* 기존 `MonitorPanel.tsx`

새 구조는 **기존 위에 추가**하는 방식으로 설계할 것.

---

## [DATA FLOW REQUIREMENTS]

### Scope read

* user selects scope
* UI calls `/api/monitor/scope`
* server resolves allowed stores/floors
* server fetches data in a single DB query layer
* server returns scoped monitor response
* UI renders according to device mode

### Correction write

* user opens action sheet
* user submits correction
* server writes overlay + correction log
* client refreshes or patches local state immediately
* corrected position becomes visible without waiting full polling interval

---

## [MENU INTEGRATION]

### super_admin

메뉴에 아래 진입점이 필요하다:

* 위치 검수 로그
* 또는 위치 오류 로그

### owner / manager

자기 범위에서 볼 수 있는 검수 기록 페이지 제공

### mobile

탐색 구조:

* 내소속 / 5층 / 6층 / 7층 / 8층
* 층 선택 후 매장 리스트 시트
* 선택 상태 유지

---

## [OUTPUT FORMAT]

반드시 아래 형식으로 답할 것:

1. FILES TO CREATE
2. FILES TO MODIFY
3. DB SCHEMA
4. API DESIGN
5. DEVICE-SPECIFIC UI DESIGN
6. BREAKPOINT STRATEGY
7. ACCESS CONTROL
8. DATA FLOW
9. MIGRATION PLAN
10. RISK / LIMITATIONS
11. QUERY STRATEGY (single-query multi-store requirement 포함)

---

## [CONSTRAINTS]

* 추측 금지
* 실제 코드 기준
* 기존 기능 깨지면 실패
* 단계별 적용 가능해야 함
* 성능 고려 필수
* API fan-out 금지
* UI는 디바이스별 분리 필수

---

## [FAIL IF]

아래 중 하나라도 해당되면 실패:

* `/api/counter/monitor` 를 매장 수만큼 여러 번 호출함
* PC UI를 모바일에 축소 적용함
* 모바일 UI를 PC에 확대 적용함
* mine scope 에 타 가게 근무 중인 내 아가씨가 빠짐
* correction 후 즉시 UI 반영 안 됨
* super_admin 을 이메일 하드코딩으로 앱 코드에서 처리함
* 기존 monitor / correction 경로를 깨뜨림
* 기존 기능 회귀 발생
* 단일 매장 구조를 그대로 유지함

---

## [STOP CONDITIONS]

다음이 모두 명확해야 한다:

* 어떤 파일을 새로 만들지
* 어떤 파일을 수정할지
* multi-store query 를 어떻게 단일 계층으로 처리할지
* desktop/tablet 와 mobile 를 어떻게 분리할지
* correction logs / BLE history 를 어디에 어떻게 기록할지
* 운영자 권한을 어떻게 안전하게 처리할지

---

## [IMPORTANT FINAL NOTE]

이 작업은 단순 UI 수정이 아니다.

이 작업은:

* 단일 매장 BLE 모니터를
* 건물 전체 관제 + 모바일 현장 대응 구조로 확장하는 작업이다.

반드시
**DB → API → 권한 → device-specific UI**
순서로 설계할 것.
