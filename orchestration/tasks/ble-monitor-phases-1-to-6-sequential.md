# NOX — BLE MONITOR PHASE 1 → 6 SEQUENTIAL EXECUTION

## [LOCK]

이 문서는 Phase 1부터 Phase 6까지를 한 번에 관리하는 실행 문서다.

하지만 실제 작업은 **반드시 한 단계씩 순차 진행**한다.

절대 금지:

* 다음 Phase 선작업
* Phase 건너뛰기
* 설계 변경
* 기존 경로 파괴
* 여러 Phase 동시 구현

허용되는 흐름:

1. 해당 Phase 구현
2. 테스트 게이트 통과
3. PASS 확인
4. 다음 Phase 진행

---

## [GLOBAL RULES]

### 공통 불변 규칙

* 기존 `/api/counter/monitor` 본문 수정 금지
* 기존 `/api/ble/corrections` 본문 수정 금지
* 기존 `/counter/monitor` 유지
* `FloorMap.tsx` 수정 금지
* Phase 6 전까지 `MonitorPanel.tsx` 의 renderDesktop/renderTablet 흐름 보존
* `lib/monitor/mergeSnapshots.ts` 에 `fetch`, `axios`, `apiFetch` 금지
* `location_correction_logs` 직접 insert 금지
* 모바일 트리에서 ops 컴포넌트 공유 금지
* `BREAKPOINT FINAL = 960px ONLY`

### CI / 리뷰 차단 규칙

각 Phase 완료 시 아래를 반드시 확인한다.

```bash
npx tsc --noEmit
npm run build
```

Phase 2 이상:

```bash
grep -n "\.from(['\"]location_correction_logs['\"])\.insert" app/ lib/
```

기대: 0 lines

Phase 3 이상:

```bash
grep -n "fetch\|apiFetch\|axios" lib/monitor/mergeSnapshots.ts
```

기대: 0 lines

Phase 5 이상:

```bash
grep -rn "from.*@/app/counter/monitor/components" app/m/ | grep -vE "statusStyles|zones|types|confidenceStyles"
```

기대: 0 lines

Phase 6 이상:

```bash
grep -rn "renderMobile" app/counter/monitor/
```

기대: 0 lines

---

# PHASE 1 — DB FOUNDATION

## 목적

DB 기반 구조를 설치한다.

## 선행 조건

없음. 단, 운영자 이메일은 DBA가 실제 `auth.users` 에서 확인해야 한다.

## FILES TO CREATE

* `database/054_location_correction_logs.sql`
* `database/055_grant_super_admin.sql`
* `database/056_ble_presence_history.sql`

## FILES TO MODIFY

* `app/api/ble/ingest/route.ts`

## EXACT CHANGES

1. `054_location_correction_logs.sql`

   * `location_correction_logs` 테이블 생성
   * 인덱스 6개 생성
   * `block_duplicate_correction()` 함수 생성
   * dedup trigger 생성
   * `deny_loc_log_mutation()` 함수 생성
   * UPDATE / DELETE 거부 trigger 생성

2. `055_grant_super_admin.sql`

   * `user_global_roles` 에 `super_admin` 부여
   * `auth.users` 에 운영자 이메일이 없으면 `RAISE EXCEPTION`

3. `056_ble_presence_history.sql`

   * `ble_presence_history` 테이블 생성
   * 인덱스 3개 생성
   * `write_location_correction()` RPC 생성

4. `app/api/ble/ingest/route.ts`

   * 기존 upsert 로직 유지
   * meaningful-change gate 추가
   * 조건:

     * room_uuid 변경
     * zone 변경
     * last_seen gap >= 10s
   * gate 통과 시에만 `ble_presence_history` insert

## RISKS

* `user_global_roles (user_id, role)` unique 부재
* 운영자 이메일 오타
* meaningful-change gate 오작동
* RPC 생성 누락

## TEST PLAN

* migration 054/055/056 순차 적용
* 테이블 2개 생성 확인
* 함수 3개 생성 확인
* 트리거 3개 생성 확인
* `super_admin` row 확인
* `location_correction_logs` append-only 확인
* 동일 correction 15초 내 dedup 확인
* heartbeat 5초 간격은 history 미증가
* 15초 간격은 history 증가

## STOP CONDITIONS

다음이 전부 PASS여야만 Phase 2 진행:

* migration apply 성공
* `super_admin` row 확인
* append-only 동작
* dedup 동작
* history gate 동작
* build / tsc green

---

# PHASE 2 — CORRECTION WRITE PATH

## 목적

위치 수정 API와 correction write 흐름 연결

## 선행 조건

Phase 1 PASS

## FILES TO CREATE

* `lib/location/errorTypes.ts`
* `lib/location/correctionWrite.ts`
* `app/api/location/correct/route.ts`

## FILES TO MODIFY

* `app/counter/monitor/components/BleCorrectionModal.tsx`

## EXACT CHANGES

1. `errorTypes.ts`

   * 5종 ErrorType union
   * `ERROR_TYPE_LABEL`
   * `isErrorType()`
   * `classifyErrorType()`

2. `correctionWrite.ts`

   * snapshot Promise.all
   * RPC `write_location_correction()` 1회 호출만 허용
   * 직접 insert 금지
   * 반환:

     * ok
     * deduplicated
     * log_id
     * overlay_correction_id
     * existing_log_id
     * applied

3. `/api/location/correct`

   * POST 라우트
   * resolveAuthContext
   * role gate: owner / manager / super_admin
   * body validation
   * error_type 자동 분류
   * super_admin 외 cross-store 차단

4. `BleCorrectionModal.tsx`

   * submit URL `/api/location/correct`
   * `error_type` select 추가
   * `correction_note` textarea 추가
   * `deduplicated:true` → info toast
   * 성공 후 기존 `onSuccess()` 유지

## RISKS

* RPC payload mismatch
* direct insert 실수
* waiter/staff/hostess 권한 우회
* cross-store guard 누락
* dedup UX 누락

## TEST PLAN

* 정상 correction 1회
* 15초 내 중복 correction → deduplicated
* 20초 후 재수정 → 신규 row
* 자동 분류 5종 테스트
* waiter/staff/hostess 403
* manager cross-store 403
* super_admin cross-store 200
* 기존 `/api/ble/corrections` 회귀 없음
* direct insert grep 0

## STOP CONDITIONS

전부 PASS여야만 Phase 3 진행:

* correction 정상
* dedup 정상
* 자동 분류 정상
* 권한 게이트 정상
* 기존 `/api/ble/corrections` 회귀 없음
* build / tsc green
* direct insert grep 0

---

# PHASE 3 — SCOPE READ SINGLE-QUERY LAYER

## 목적

multi-store 읽기 핵심 API 계층 구현

## 선행 조건

Phase 2 PASS

## FILES TO CREATE

* `lib/monitor/scopeResolver.ts`
* `lib/monitor/mergeSnapshots.ts`
* `app/api/monitor/scope/route.ts`
* `app/api/monitor/stores/route.ts`
* `app/api/monitor/movement/[membership_id]/route.ts`

## FILES TO MODIFY

* `app/counter/monitor/hooks/useMonitorData.ts`
* `app/counter/components/CounterBleMinimapWidget.tsx`

## EXACT CHANGES

1. `scopeResolver.ts`

   * scope:

     * mine
     * current_floor
     * floor-5/6/7/8
     * store-<uuid>
   * super_admin만 floor-N 허용
   * 비-super는 자기 매장만

2. `mergeSnapshots.ts`

   * 순수 함수만
   * HTTP 호출 금지
   * Map 기반 조립
   * 결과:

     * stores[]
     * home_workers[]
     * foreign_workers_at_mine[]
     * movement[]

3. `/api/monitor/scope`

   * 단일 query layer
   * `/api/counter/monitor` fan-out 금지
   * Q1~Q9 구조
   * Q9는 아래 정정본 사용:

```sql
FROM cross_store_work_records cswr
JOIN room_sessions rs
  ON rs.id = cswr.session_id
 AND rs.status = 'active'
 AND rs.deleted_at IS NULL
JOIN stores s
  ON s.id = cswr.working_store_uuid
WHERE cswr.origin_store_uuid = $auth_store_uuid
  AND cswr.status IN ('pending','approved')
  AND cswr.deleted_at IS NULL
```

4. `/api/monitor/stores`

   * floor별 매장 목록
   * is_mine / active_sessions / total_rooms

5. `/api/monitor/movement/[membership_id]`

   * BLE history + business events
   * 24h window
   * LIMIT 100

6. `useMonitorData.ts`

   * 기본 mine 경로 하위호환 유지
   * scope가 mine 외일 때만 신규 API 사용

7. `CounterBleMinimapWidget.tsx`

   * placeholder 제거
   * 실제 scoped data 사용

## RISKS

* mergeSnapshots에서 fetch 사용
* fan-out 실수
* Q9 쿼리 오타
* 하위호환 shape 깨짐
* 권한 우회

## TEST PLAN

* `scope=mine` 회귀 0
* super_admin `floor-5` 정상
* manager 타층 403
* store-<uuid> 타매장 403
* mine scope에 cross-store working 포함
* session ended 후 즉시 탈락
* movement API 24h trail
* 14매장 p95 < 1.5s
* mergeSnapshots grep 0

## STOP CONDITIONS

전부 PASS여야만 Phase 4/5 진행:

* mine 회귀 없음
* floor scope 정상
* 권한 정상
* movement 정상
* 성능 통과
* mergeSnapshots grep 0
* build / tsc green

---

# PHASE 4 — ADMIN REVIEW UI & APIs

## 목적

검수 로그 조회 / 운영자 UI 구현

## 선행 조건

Phase 2 PASS
Phase 3과 병렬 가능하지만, 실제 조회 검증은 Phase 3 API 상태도 참고한다.

## FILES TO CREATE

* `app/api/location/corrections/by-user/route.ts`
* `app/api/location/corrections/daily-summary/route.ts`
* `app/api/location/corrections/overview/route.ts`
* `app/super-admin/location-corrections/page.tsx`
* `app/admin/location-corrections/page.tsx`

## FILES TO MODIFY

* `app/super-admin/page.tsx`
* `middleware.ts`

## EXACT CHANGES

1. by-user API

   * keyset cursor
   * super_admin 외 자기 매장 필터 강제

2. daily-summary API

   * corrected_on group by
   * 5종 count filter

3. overview API

   * super_admin only
   * totals / by_store / by_floor / by_reviewer

4. super-admin page

   * 필터
   * 요약
   * 매장 비교
   * 검수자 랭킹
   * 상세 로그

5. admin page

   * 자기 매장 전용
   * overview 없음
   * 이메일 마스킹

6. super-admin page 링크 추가

   * 위치 검수 로그

## RISKS

* 권한 우회
* overview 일반 role 노출
* offset pagination 실수
* 이메일 마스킹 정책 누락

## TEST PLAN

* owner overview 403
* super_admin overview 200
* 타매장 by-user 조회 차단
* super-admin 페이지 렌더
* admin 페이지 렌더
* 링크 노출
* build / tsc green

## STOP CONDITIONS

전부 PASS여야 다음 단계 진행:

* overview 권한 정상
* by-user 필터 정상
* UI 렌더 정상
* build / tsc green

---

# PHASE 5 — MOBILE TREE (/m/monitor)

## 목적

모바일 전용 트리 구현

## 선행 조건

Phase 3 PASS
Phase 4는 병렬 가능하지만, 실제 correction/action sheet는 Phase 2/3이 먼저 안정적이어야 함

## FILES TO CREATE

* `lib/ui/useDeviceMode.ts`
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

## FILES TO MODIFY

* `middleware.ts`

## EXACT CHANGES

1. `useDeviceMode.ts`

   * 960 기준
   * 우선순위:

     * query override
     * localStorage
     * viewport width
     * SSR UA hint

2. `/m/monitor`

   * 1차 메뉴: 내소속 / 5F / 6F / 7F / 8F
   * 전체층 탭 없음
   * 내소속 기본 진입
   * 층 탭 → StoreListSheet

3. `/m/monitor/store/[store_uuid]`

   * 섹션 순서:

     * MobileMiniMap
     * 실시간 위치
     * 이탈
     * 최근 이동
     * 층 요약(super_admin only)

4. `MobileMiniMap`

   * 선택된 1명만 동선
   * PC용 FloorMap 재사용 금지

5. `LocationCorrectionSheet`

   * 4-step
   * correction 후 optimistic patch + refresh

6. localStorage

   * 마지막 floor/store 저장 및 복원

## RISKS

* Ops 컴포넌트 import
* shared component 유혹
* SSR/CSR mismatch
* 4-step state 초기화
* correction 후 즉시 반영 누락

## TEST PLAN

* 모바일 진입 정상
* 층 → 매장 선택 정상
* action sheet 정상
* correction sheet 정상
* 즉시 반영 정상
* dedup toast 정상
* floor/store 복원 정상
* import grep 0
* build / tsc green

## STOP CONDITIONS

전부 PASS여야 Phase 6 진행:

* 모바일 UX 정상
* correction 즉시 반영
* import 격리 정상
* build / tsc green

---

# PHASE 6 — DEVICE ROUTER & renderMobile REMOVAL

## 목적

공용 진입점과 최종 디바이스 분리 연결

## 선행 조건

Phase 5 PASS

## FILES TO CREATE

* `app/monitor/page.tsx`

## FILES TO MODIFY

* `app/counter/monitor/MonitorPanel.tsx`
* `app/m/monitor/store/[store_uuid]/page.tsx`
* `middleware.ts`

## EXACT CHANGES

1. `/monitor`

   * 서버 컴포넌트
   * `?force`
   * cookie
   * UA 기준 redirect

2. `MonitorPanel.tsx`

   * renderMobile 완전 제거
   * MobileTabBar 제거
   * ops에서 mobile 진입 시 배너만

3. mobile store page

   * ops 감지 시 배너 표시

4. middleware

   * `/monitor` matcher 추가

## RISKS

* Phase 5 전에 수행
* renderMobile 잔존
* UA 오탐
* wrong tree flash
* ops 회귀

## TEST PLAN

* `/monitor` desktop → `/counter/monitor`
* `/monitor` mobile → `/m/monitor`
* `?force=ops`
* mobile에서 `/counter/monitor` → 배너만
* desktop에서 `/m/monitor` → 배너 + 본문
* renderMobile grep 0
* build / tsc green

## STOP CONDITIONS

전부 PASS여야 종료:

* `/monitor` 정상
* renderMobile 0
* ops/mobile 분리 정상
* build / tsc green

---

## [EXECUTION INSTRUCTION TO CLAUDE CODE]

이 문서는 Phase 1~6 통합 실행 문서다.

반드시 다음 규칙으로 진행해라:

1. 지금 당장 모든 Phase를 구현하지 마라
2. 항상 현재 Phase 하나만 작업해라
3. 해당 Phase의 TEST PLAN을 통과했다고 명시한 뒤에만 다음 Phase로 넘어가라
4. 다음 Phase를 시작할 때는 이전 Phase PASS를 전제로 하라
5. 설계 수정 금지
6. 기존 경로 파괴 금지

현재 시작 Phase는 사용자가 따로 지정한다.

사용자가

* "Phase 2 시작"
* "Phase 3 시작"
  처럼 말하면
  그 Phase만 작업해라.
