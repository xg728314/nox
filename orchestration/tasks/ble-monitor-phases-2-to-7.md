# NOX — BLE MONITOR IMPLEMENTATION (PHASE 2 → PHASE 7)

## [IMPORTANT]

이 문서는 Phase 2부터 Phase 7까지를 한 파일에 정리한 것이다.

하지만 실행은 반드시 **순차적으로** 한다.

절대 금지:

* Phase 건너뛰기
* 여러 Phase 동시 구현
* 설계 변경
* 기존 경로 파괴

실행 순서 고정:

1. Phase 2
2. Phase 3
3. Phase 4
4. Phase 5
5. Phase 6
6. Phase 7

Phase 1은 이미 완료되었다고 가정한다.

---

# PHASE 2 — CORRECTION WRITE PATH

## 목적

위치 오류 수정 경로를 실제 API/클라이언트에 연결한다.

## 목표

* `/api/location/correct` 구현
* `write_location_correction()` RPC 연결
* BleCorrectionModal 연결
* dedup 응답 처리
* correction 후 즉시 UI 반영

## 대상 파일

### CREATE

* `lib/location/errorTypes.ts`
* `lib/location/correctionWrite.ts`
* `app/api/location/correct/route.ts`

### MODIFY

* `app/counter/monitor/components/BleCorrectionModal.tsx`

## 요구사항

### 1. errorTypes

* ErrorType enum 정의
* classifyErrorType() 구현
* 자동 분류 허용

### 2. correctionWrite

* 직접 insert 금지
* 반드시 RPC `write_location_correction()` 경유
* 스냅샷 조회 Promise.all
* 반환값:

  * ok
  * deduplicated
  * log_id
  * overlay_correction_id
  * applied

### 3. API

* POST `/api/location/correct`
* resolveAuthContext 사용
* role gate: owner / manager / super_admin 만 허용
* body validation
* error_type 없으면 자동 분류

### 4. BleCorrectionModal

* 제출 URL 변경: `/api/ble/corrections` → `/api/location/correct`
* `error_type` select 추가
* `correction_note` textarea 추가
* 성공 시 onSuccess() 유지
* `deduplicated:true` 응답이면 info toast

## 위험 포인트

* RPC payload key mismatch
* 직접 insert 실수
* dedup 응답 UX 누락
* waiter/staff 차단 누락

## 테스트 게이트

* tsc/build green
* 정상 correction 1회 → 3테이블 각각 1 row
* 동일 correction 15초 내 재요청 → `deduplicated:true`
* 20초 후 재요청 → 신규 row
* waiter role → 403
* 기존 `/api/ble/corrections` 회귀 없음

---

# PHASE 3 — SCOPE READ SINGLE-QUERY LAYER

## 목적

multi-store 조회의 핵심 API 계층 구현

## 목표

* `/api/monitor/scope`
* `/api/monitor/stores`
* `/api/monitor/movement/[membership_id]`
* `mergeSnapshots.ts`
* `scopeResolver.ts`
* 기존 monitor 하위호환 유지

## 대상 파일

### CREATE

* `lib/monitor/scopeResolver.ts`
* `lib/monitor/mergeSnapshots.ts`
* `app/api/monitor/scope/route.ts`
* `app/api/monitor/stores/route.ts`
* `app/api/monitor/movement/[membership_id]/route.ts`

### MODIFY

* `app/counter/monitor/hooks/useMonitorData.ts`
* `app/counter/components/CounterBleMinimapWidget.tsx`

## 절대 규칙

* `mergeSnapshots.ts` 에서 `fetch`, `axios`, `apiFetch` 금지
* `/api/counter/monitor` 반복 호출 금지
* 단일 query layer 사용
* `WHERE store_uuid IN (...)` 구조 유지

## scope 규칙

* mine
* current_floor
* floor-5 / 6 / 7 / 8
* store-<uuid>

## 핵심 요구

* Q9 쿼리는 정정본 사용
* `cross_store_work_records` 는 `ended_at` 쓰지 말 것
* 아래 조건 사용:

```sql
WHERE cswr.origin_store_uuid = $auth_store_uuid
  AND cswr.status IN ('pending','approved')
  AND cswr.deleted_at IS NULL
```

그리고 `room_sessions.status='active'` JOIN 포함

## mine scope 필수

* 내 매장 소속 인원
* 타 매장에서 현재 근무 중인 내 매장 소속 인원 포함

## 위험 포인트

* HTTP fan-out
* Q5/Q9 조립 오류
* 하위호환 shape 깨짐
* 권한 오판

## 테스트 게이트

* tsc/build green
* `scope=mine` 응답 기존 monitor 회귀 없음
* super_admin `floor-5` 응답 정상
* manager 타 층 요청 403
* working_store_uuid 포함 확인
* movement API 24h trail 정상
* 14매장 기준 p95 < 1.5s

---

# PHASE 4 — ADMIN REVIEW UI & APIs

## 목적

운영자 / 매장장 검수 로그 조회 기능 구현

## 목표

* by-user
* daily-summary
* overview
* super-admin page
* admin page

## 대상 파일

### CREATE

* `app/api/location/corrections/by-user/route.ts`
* `app/api/location/corrections/daily-summary/route.ts`
* `app/api/location/corrections/overview/route.ts`
* `app/super-admin/location-corrections/page.tsx`
* `app/admin/location-corrections/page.tsx`

### MODIFY

* `app/super-admin/page.tsx`
* `middleware.ts`

## 요구사항

* super_admin 외 overview 403
* owner/manager 는 자기 매장 범위만
* keyset cursor 사용
* 무한 스크롤 허용
* 필터:

  * 날짜
  * 층
  * 매장
  * 검수자
  * 오류유형

## UI 요구

* 상단 요약
* 매장 비교
* 검수자 랭킹
* 상세 로그

## 위험 포인트

* 권한 우회
* 이메일 과다 노출
* offset pagination 사용
* overview를 일반 role에 노출

## 테스트 게이트

* owner overview 403
* super_admin overview 정상
* by-user 자기매장 필터 정상
* super-admin page 진입 성공
* 네비 링크 노출

---

# PHASE 5 — MOBILE TREE (/m/monitor)

## 목적

모바일 전용 미니맵 / 탐색 UI 구현

## 목표

* /m/monitor
* /m/monitor/store/[store_uuid]
* TopTabs
* StoreListSheet
* MobileMiniMap
* ActionSheet
* CorrectionSheet
* MovementHistorySheet

## 대상 파일

### CREATE

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
* `lib/ui/useDeviceMode.ts`

### MODIFY

* `middleware.ts`

## 모바일 구조

1. 내소속 / 5F / 6F / 7F / 8F
2. 층 선택 시 매장 sheet
3. 단일 매장 페이지 진입
4. 섹션 순서:

   * 미니맵
   * 실시간 위치
   * 이탈
   * 최근 이동
   * 층 요약(super_admin)

## 절대 규칙

* 한 화면 = 한 매장
* 전체층 탭 없음
* 선택된 1명만 동선 표시
* PC 컴포넌트 import 금지
* 공유 허용: types / zones / statusStyles / confidenceStyles 만

## 위험 포인트

* Shared component 만들기
* SSR/CSR mismatch
* step state 초기화
* correction 후 refresh 누락

## 테스트 게이트

* 모바일에서 /m/monitor 진입
* 층 → 매장 선택 정상
* action sheet 정상
* 4-step correction 정상
* correction 후 즉시 반영
* dedup info toast 정상
* last selected floor/store 복원
* app/m/** 에 ops 컴포넌트 import 없음

---

# PHASE 6 — DEVICE ROUTER & renderMobile REMOVAL

## 목적

공용 진입 라우터와 디바이스 분리 최종 연결

## 목표

* `/monitor` 공용 진입
* ops/mobile 자동 분기
* MonitorPanel renderMobile 제거
* 트리별 경고 배너

## 대상 파일

### CREATE

* `app/monitor/page.tsx`

### MODIFY

* `app/counter/monitor/MonitorPanel.tsx`
* `app/m/monitor/store/[store_uuid]/page.tsx`
* `middleware.ts`

## BREAKPOINT FINAL

* `>= 960px` → ops
* `< 960px` → mobile

## useDeviceMode 규칙

우선순위:

1. query override
2. localStorage
3. viewport width
4. SSR UA hint

## 절대 규칙

* renderMobile 제거
* ops 트리에서 mobile 본문 렌더 금지
* mobile 트리에서 ops 확장 UI 금지

## 위험 포인트

* Phase 5 전에 수행 금지
* UA 판정 오탐
* 잘못된 트리 flash
* MonitorPanel 회귀

## 테스트 게이트

* `/monitor` desktop → `/counter/monitor`
* `/monitor` mobile → `/m/monitor`
* `?force=ops` 동작
* `/counter/monitor` mobile direct → 배너만
* `/m/monitor` desktop direct → 배너 + 본문
* grep `renderMobile` = 0
* build green

---

# PHASE 7 — RETENTION CRON

## 목적

BLE history 30일 정리 자동화

## 목표

* reaper cron route
* vercel cron 설정
* history retention 실행

## 대상 파일

### CREATE

* `app/api/cron/ble-history-reaper/route.ts`

### MODIFY

* `vercel.json`

## 요구사항

* CRON_SECRET 검증
* vercel-cron user-agent 검증
* 30일 초과 row delete
* rows_affected 반환

## 위험 포인트

* 대량 delete lock
* secret 없는 접근
* timezone 경계
* cron 미설정

## 테스트 게이트

* secret 포함 호출 200
* secret 없는 호출 401
* 30일 초과 row 삭제
* 최근 row 유지
* cron 등록 확인

---

# GLOBAL RULES

## PR reject 기준

* Phase 순서 변경
* mergeSnapshots HTTP import
* correction direct insert
* ops/mobile 컴포넌트 공유
* renderMobile 잔존
* 기존 /api/counter/monitor 파괴

## CI 체크

* `npx tsc --noEmit`
* `npm run build`
* `grep -n "fetch|apiFetch|axios" lib/monitor/mergeSnapshots.ts`
* `grep -rn "from.*app/counter/monitor/components" app/m/`
* `grep -rn "renderMobile" app/counter/monitor/`
* `grep -n "\.from(['\"]location_correction_logs['\"]).insert" app/`

---

# OUTPUT FORMAT

각 Phase 실행 시 반드시 아래 형식으로 답할 것:

1. FILES TO CREATE
2. FILES TO MODIFY
3. EXACT CHANGES
4. RISKS
5. TEST PLAN
6. STOP CONDITIONS

---

# FINAL RULE

이 문서는 한 번에 정리한 실행 문서다.

하지만 실제 작업은:

* Phase 하나 끝내고
* 테스트 게이트 통과하고
* 그다음 다음 Phase

이 순서만 허용한다.
