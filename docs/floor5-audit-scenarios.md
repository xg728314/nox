# Floor-5 Reality Audit Scenarios

> 5층 실운영 기준 교차검증 시나리오 문서
> 생성일: 2026-04-15
> 목적: 다음 감사 라운드에서 코드/DB/API/UI를 이 시나리오 기준으로 검증

---

## 1. 매장 구성

| 매장 | store_uuid | 비고 |
|------|-----------|------|
| 마블 | (live DB) | 5층 |
| 라이브 | (live DB) | 5층 |
| 버닝 | (live DB) | 5층 |
| 황진이 | (live DB) | 5층 |

- 각 매장은 독립 store_uuid
- owner 1명 + manager 1~2명 + hostess 다수
- 아가씨는 서로 다른 가게에서 근무 가능 (교차근무)

---

## 2. 교차근무 (Cross-Store Hostess Work)

### 시나리오 2-1: 마블 소속 아가씨 A가 라이브에서 근무

**전제:**
- 아가씨 A: `origin_store_uuid = 마블`
- 세션: `store_uuid = 라이브`, `session_id = xxx`
- 참여자: `session_participants.store_uuid = 라이브`, `origin_store_uuid = 마블`

**검증 항목:**
- [ ] `session_participants` 레코드의 `store_uuid`는 라이브 (워킹매장)
- [ ] `session_participants` 레코드의 `origin_store_uuid`는 마블 (원소속)
- [ ] 라이브 owner는 해당 세션 데이터를 볼 수 있음
- [ ] 마블 owner는 라이브 세션 데이터를 볼 수 없음
- [ ] 정산은 `origin_store_uuid` 기준 — 마블로 귀속
- [ ] `cross_store_settlements` 테이블에 정산 기록 생성
- [ ] 워킹매장(라이브) 수수료 없음

### 시나리오 2-2: 같은 아가씨가 하루에 2개 매장에서 근무

**검증 항목:**
- [ ] 마블 세션과 라이브 세션이 각각 독립적으로 존재
- [ ] 각 세션의 `store_uuid`가 해당 워킹매장
- [ ] owner 조회 시 자기 매장 데이터만 반환
- [ ] manager 조회 시 자기 scope만 반환
- [ ] 일일 리포트(`/api/reports/daily`)에서 교차근무 아가씨 이중 집계 없음

---

## 3. 양주 판매 (Liquor Revenue Split)

### 시나리오 3-1: 방당 3병 판매

**전제:**
- 업주 입금가 (store_price): 13만원/병
- 실장 판매가 (sale_price): 18만원/병 또는 20만원/병
- 판매 수량: 3병

**18만원 판매 시:**
| 항목 | 계산 | 금액 |
|------|------|------|
| owner revenue (store_price * qty) | 130,000 * 3 | 390,000원 |
| customer billing (sale_price * qty) | 180,000 * 3 | 540,000원 |
| manager profit (sale-store)*qty | 50,000 * 3 | 150,000원 |

**20만원 판매 시:**
| 항목 | 계산 | 금액 |
|------|------|------|
| owner revenue (store_price * qty) | 130,000 * 3 | 390,000원 |
| customer billing (sale_price * qty) | 200,000 * 3 | 600,000원 |
| manager profit (sale-store)*qty | 70,000 * 3 | 210,000원 |

**검증 항목:**
- [ ] `orders` 테이블: `store_price=130000`, `sale_price=180000` or `200000`, `qty=3`
- [ ] `orders.manager_amount = (sale_price - store_price) * qty`
- [ ] `orders.customer_amount = sale_price * qty`
- [ ] `receipts.order_total_amount` = sum of `customer_amount` (손님 기준)
- [ ] owner API 응답에 `manager_amount` 비포함 (기본)
- [ ] manager visibility toggle ON 시에만 owner에게 `manager_amount` 공개
- [ ] `inventory_transactions`에서 3병 차감 기록

### 시나리오 3-2: 재고 차감 일치성

**검증 항목:**
- [ ] 주문 POST 시 `inventory_items.current_stock` 차감
- [ ] 3병 주문 → current_stock 3 감소
- [ ] 음수 재고 가능 여부 확인 (현재 차단하지 않음 — 경고만)
- [ ] 타 매장 재고 섞임 없음 (`store_uuid` 스코프)
- [ ] owner만 재고 품목 추가 가능 (role guard)

---

## 4. 사장 열람 권한 (Owner Visibility)

### 시나리오 4-1: 기본 비공개 상태

**전제:** manager visibility toggles = OFF (default)

**검증 항목 — API 응답 레벨:**
- [ ] `GET /api/store/settlement/overview` → `manager_amount`, `hostess_amount` 미포함
- [ ] `POST /api/sessions/settlement` → `manager_amount`, `hostess_amount` 미포함
- [ ] `POST /api/sessions/settlement/finalize` → `manager_amount`, `hostess_amount` 미포함
- [ ] `GET /api/reports/daily` → `manager_total=0`, `hostess_total=0`, breakdowns 빈 배열
- [ ] `POST /api/sessions/receipt` → snapshot의 settlement에서 `manager_amount=0`, `hostess_amount=0`
- [ ] `GET /api/sessions/receipt` → 동일 strip 적용
- [ ] `GET /api/owner/settlement` → 개별 수익 비노출

**사장이 볼 수 있는 항목:**
- [ ] 양주판매내역 (주문 목록, customer_amount)
- [ ] 웨이터봉사비
- [ ] TC (타임수, 총액만 — 개별 타임 단가 분해 금지)
- [ ] 총매출 (gross_total)
- [ ] 사장마진 (margin_amount)

**사장이 볼 수 없는 항목:**
- [ ] 실장 개별 수익 (manager_payout_amount)
- [ ] 아가씨 개별 수익 (hostess_payout_amount)
- [ ] 타임당 공제액

### 시나리오 4-2: visibility ON 상태

**전제:** manager가 `show_profit_to_owner = true` 설정

**검증 항목:**
- [ ] `PATCH /api/manager/visibility` 정상 동작
- [ ] owner API 응답에 해당 manager의 `manager_amount` 포함 (향후 구현)
- [ ] `show_hostess_profit_to_owner = true` 시 아가씨 수익도 공개 (향후 구현)
- [ ] audit_events에 toggle 변경 기록

---

## 5. 종목별 단가 검증 (Service Type Unit Calculation)

### 전제 (store_service_types DB 기준)

| 종목 | 기본시간 | 기본단가 | 반티시간 | 반티단가 | 차3시간 | 차3단가 |
|------|---------|---------|---------|---------|--------|--------|
| 퍼블릭 | 90분 | 13만원 | 45분 | 7만원 | 9~15분 | 3만원 |
| 셔츠 | 60분 | 14만원 | 30분 | 7만원 | 9~15분 | 3만원 |
| 하퍼 | 60분 | 12만원 | 30분 | 6만원 | 9~15분 | 3만원 |

### 시나리오 5-1: 퍼블릭 4건 평균

**전제:** 한 아가씨가 4건 기본 참여

**검증 항목:**
- [ ] `session_participants.price_amount` = 130,000 * 4 = 520,000원 (합산)
- [ ] `session_participants.category` = "퍼블릭" 또는 해당 종목 코드
- [ ] `session_participants.time_minutes` = 90 (기본)
- [ ] 단가는 DB `store_service_types`에서 조회 — 하드코딩 없음
- [ ] receipt/session/participant 수치 일치

### 시나리오 5-2: 셔츠 6건 평균

**검증 항목:**
- [ ] 기본단가 140,000원 * 6 = 840,000원
- [ ] 인사확인 옵션 존재 여부 확인
- [ ] `session_participants.time_minutes` = 60 (기본)

### 시나리오 5-3: 하퍼 6건 평균

**검증 항목:**
- [ ] 기본단가 120,000원 * 6 = 720,000원
- [ ] `session_participants.time_minutes` = 60 (기본)

### 시나리오 5-4: 경계구간 처리

**전제:** 반티+10분 경계

**검증 항목:**
- [ ] 0~8분: 기본 0원, 실장 재량 지급 가능
- [ ] 경계구간: UI에서 반티 or 반티+차3 중 실장이 선택
- [ ] 모든 계산이 DB 설정값 기준

---

## 6. 채팅 접근 제어 (Chat Access)

### 시나리오 6-1: hostess room_session 접근

**검증 항목:**
- [ ] hostess가 자기 참여 session의 room_session 채팅 접근 가능
- [ ] hostess가 타 session의 room_session 채팅 접근 시 403
- [ ] hostess가 타 store 채팅 접근 시 404 (store_uuid 스코프)
- [ ] POST `/api/chat/rooms` type=room_session → session_participants 검증
- [ ] POST `/api/chat/messages` → room_session 타입 defense-in-depth 검증
- [ ] GET `/api/chat/messages` → room_session 타입 defense-in-depth 검증

### 시나리오 6-2: 채팅 타입 구분

**검증 항목:**
- [ ] `global`: 매장 전체, 모든 role 참여 가능
- [ ] `group`: owner/manager만 생성 가능, hostess 생성 불가
- [ ] `room_session`: session_id 필수, hostess는 참여자만
- [ ] `direct`: 1:1 DM, 같은 store_uuid 내 membership 간
- [ ] DB CHECK constraint: type IN ('global','group','room_session','direct')

### 시나리오 6-3: Realtime 반영

**검증 항목:**
- [ ] `chat_messages` INSERT → Supabase Realtime postgres_changes 수신
- [ ] 새 메시지 즉시 UI 반영 (중복 방지 포함)
- [ ] unread_count 자동 증가 (타 참여자)
- [ ] 읽음 처리 시 unread_count 리셋

---

## 7. 재고 일관성 (Inventory Consistency)

### 시나리오 7-1: 주문-재고 연동

**전제:** 양주 품목 current_stock = 10, 주문 3병

**검증 항목:**
- [ ] 주문 POST 후 current_stock = 7
- [ ] `inventory_transactions` 레코드 생성 (type=order_out)
- [ ] transaction.quantity = -3 (또는 3 with type indicating out)
- [ ] transaction.before_stock = 10, after_stock = 7
- [ ] 주문 취소(삭제) 시 재고 복원 여부 확인

### 시나리오 7-2: 타 매장 격리

**검증 항목:**
- [ ] 마블 재고와 라이브 재고 완전 분리
- [ ] 마블 주문이 라이브 재고에 영향 없음
- [ ] API 쿼리에 `store_uuid` WHERE 조건 필수

### 시나리오 7-3: store_price 연동

**검증 항목:**
- [ ] 재고 품목의 `store_price` = 주문 시 `orders.store_price`
- [ ] 재고 품목의 `unit_cost`가 fallback (store_price 없을 때)
- [ ] `cost_per_box`, `units_per_box` → `cost_per_unit` 자동 계산

---

## 8. 정산 일관성 (Settlement Consistency)

### 시나리오 8-1: 전체 정산 흐름

**전제:** 퍼블릭 4건 + 양주 3병(18만원) 세션

| 항목 | 금액 |
|------|------|
| participant_total (4 * 130,000) | 520,000 |
| order_total (customer: 3 * 180,000) | 540,000 |
| gross_total | 1,060,000 |
| manager_order_profit (3 * 50,000) | 150,000 |
| TC (rate 적용) | rate * gross |
| hostess_amount | sum(hostess_payout_amount) |
| margin | gross - TC - manager - hostess |

**검증 항목:**
- [ ] `receipts.gross_total` = participant_total + order_total
- [ ] `receipts.order_total_amount` = customer_amount 합
- [ ] `receipts.participant_total_amount` = price_amount 합
- [ ] `receipts.manager_amount` = sum(manager_payout_amount) + order manager profit
- [ ] `receipts.margin_amount` = gross - TC - manager - hostess
- [ ] draft → finalized 전환 시 재계산
- [ ] finalized 후 수정 불가 (409)

### 시나리오 8-2: 선정산 차감

**검증 항목:**
- [ ] 선정산 금액이 최종 정산에서 차감
- [ ] `pre_settlements.status` = "deducted" 전환
- [ ] margin 계산에 선정산 반영

---

## 감사 라운드 실행 지침

1. 위 시나리오를 순서대로 코드 기준으로 검증
2. 각 항목의 pass/fail 기록
3. fail 항목은 root cause + 영향 범위 + 수정 방안 문서화
4. 자동 수정 금지 — 문제 목록만 출력
5. 우선순위: P0 (데이터 무결성) > P1 (보안/권한) > P2 (기능) > P3 (UI)
