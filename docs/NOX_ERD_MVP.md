# NOX ERD MVP (LOCKED)

## 0. PURPOSE
이 문서는 NOX 1차 MVP의 핵심 데이터 구조를 정의한다.

목표:
- DB 구조 고정
- API / UI 구현 전에 데이터 기준 잠금
- 관계형 구조 혼선 방지

주의:
이 문서는 MVP 기준이다.
BLE, 채팅, 다층 확장, 고급 권한 구조는 포함하지 않는다.

---

## 1. CORE DESIGN PRINCIPLES

### 1.1 IDENTITY RULE
- session_id = runtime identity
- room_uuid = canonical room identity
- store_uuid = security scope
- room_no = display only
- business_date = aggregation key

### 1.2 MVP RULE
- 1 store
- 최소 1 floor
- 1~2 room
- 1 session flow
- 기본 settlement flow

### 1.3 SERVER TRUTH
- 돈 계산은 서버 기준
- 핵심 상태는 DB 기준
- 화면은 표시용

---

## 2. CORE TABLES

### 2.1 users
목적:
- 로그인 계정 기본 정보

핵심 컬럼:
- id (uuid, pk)
- email
- phone
- display_name
- auth_status
- created_at
- updated_at
- last_login_at

비고:
- 실제 인증 연동 주체
- 승인 전/후 상태 필요

---

### 2.2 store_memberships
목적:
- 사용자와 가게 연결
- 역할 및 승인 상태 관리

핵심 컬럼:
- id (uuid, pk)
- user_id (fk -> users.id)
- store_uuid
- role
- status
- approved_by
- approved_at
- created_at
- updated_at

상태 예시:
- pending
- approved
- rejected
- suspended

역할 예시:
- owner
- manager
- hostess

비고:
- MVP 권한 구조 핵심 테이블

---

### 2.3 stores
목적:
- 가게 정보

핵심 컬럼:
- store_uuid (uuid, pk)
- store_name
- status
- created_at
- updated_at

---

### 2.4 floors
목적:
- 가게 내 층 구분

핵심 컬럼:
- id (uuid, pk)
- store_uuid (fk -> stores.store_uuid)
- floor_no
- floor_name
- created_at
- updated_at

---

### 2.5 rooms
목적:
- 실제 운영 방 정보

핵심 컬럼:
- room_uuid (uuid, pk)
- store_uuid (fk -> stores.store_uuid)
- floor_id (fk -> floors.id)
- room_no
- room_name
- room_status
- created_at
- updated_at

상태 예시:
- empty
- occupied

주의:
- room_no는 표시용
- 조회/연결 기준은 room_uuid

---

### 2.6 sessions
목적:
- 방에서 시작되는 영업 세션

핵심 컬럼:
- session_id (uuid, pk)
- store_uuid (fk -> stores.store_uuid)
- room_uuid (fk -> rooms.room_uuid)
- business_date
- session_status
- started_at
- ended_at
- created_by
- ended_by
- created_at
- updated_at

상태 예시:
- active
- ended

주의:
- 같은 room_uuid에 active session 중복 금지
- session_id가 실행 기준 식별자

---

### 2.7 session_participants
목적:
- 세션 참여자 연결

핵심 컬럼:
- id (uuid, pk)
- session_id (fk -> sessions.session_id)
- store_uuid
- participant_type
- membership_id (nullable, fk -> store_memberships.id)
- display_name (nullable)
- customer_headcount (nullable)
- joined_at
- left_at
- participant_status
- created_at
- updated_at

participant_type 예시:
- customer
- hostess
- manager

participant_status 예시:
- active
- left

주의:
- customer는 로그인 계정 아님
- customer는 headcount 또는 익명 participant 처리

---

### 2.8 menu_items
목적:
- 판매 항목 기본 마스터

핵심 컬럼:
- id (uuid, pk)
- store_uuid
- item_name
- item_type
- unit_price
- is_active
- created_at
- updated_at

item_type 예시:
- liquor
- beer
- beverage

주의:
- MVP에서는 재고 아님
- 오더 기록용 기준 데이터

---

### 2.9 orders
목적:
- 세션 오더 기록

핵심 컬럼:
- id (uuid, pk)
- session_id (fk -> sessions.session_id)
- store_uuid
- business_date
- menu_item_id (fk -> menu_items.id)
- quantity
- unit_price_snapshot
- line_total
- ordered_at
- created_by
- created_at
- updated_at

주의:
- 재고 수불 아님
- 세션에 붙는 금액 기록

---

### 2.10 settlements
목적:
- 세션 종료 후 정산 결과 저장

핵심 컬럼:
- id (uuid, pk)
- session_id (fk -> sessions.session_id, unique 권장)
- store_uuid
- business_date
- total_duration_minutes
- customer_payment
- hostess_payout
- manager_share
- owner_profit
- pricing_rule_snapshot
- settlement_status
- settled_at
- settled_by
- created_at
- updated_at

상태 예시:
- draft
- finalized

주의:
- 금액 계산은 서버 수행
- session당 1 settlement 기본 구조

---

### 2.11 action_logs
목적:
- 최소 행위 로그 기록

핵심 컬럼:
- id (uuid, pk)
- store_uuid
- business_date
- actor_membership_id (nullable)
- action_type
- target_type
- target_id
- action_payload
- created_at

예시 action_type:
- signup_requested
- signup_approved
- session_created
- participant_added
- order_added
- session_ended
- settlement_finalized

---

## 3. RELATIONSHIPS

### 핵심 관계
- users 1:N store_memberships
- stores 1:N floors
- stores 1:N rooms
- stores 1:N sessions
- stores 1:N menu_items
- stores 1:N orders
- stores 1:N settlements
- stores 1:N action_logs

- floors 1:N rooms
- rooms 1:N sessions
- sessions 1:N session_participants
- sessions 1:N orders
- sessions 1:1 settlements

- store_memberships 1:N session_participants
- store_memberships 1:N action_logs (actor 기준)

---

## 4. REQUIRED FIELDS BY TABLE

### store_uuid required
다음 테이블은 반드시 store_uuid 포함:
- store_memberships
- floors
- rooms
- sessions
- session_participants
- menu_items
- orders
- settlements
- action_logs

### business_date required
다음 테이블은 반드시 business_date 포함:
- sessions
- orders
- settlements
- action_logs

---

## 5. MVP STATUS ENUMS

### auth_status / membership status
- pending
- approved
- rejected
- suspended

### room_status
- empty
- occupied

### session_status
- active
- ended

### participant_status
- active
- left

### settlement_status
- draft
- finalized

---

## 6. MVP CONSTRAINTS

### 6.1 UNIQUE / SAFETY
- 동일 room_uuid에 active session 중복 금지
- 동일 session_id에 settlement 중복 금지
- session 종료 후 settlement 생성 가능
- room_no는 unique display 정책으로 관리 가능하나 identity 아님

### 6.2 SECURITY
- 모든 접근은 store_uuid 범위 유지
- room_no 단독 조회 금지
- 고객(customer)은 로그인 계정으로 처리하지 않음

### 6.3 LOGGING
- 핵심 액션은 action_logs에 남김

---

## 7. INDEX DIRECTION (MVP)

우선 고려 인덱스:
- store_memberships (user_id, store_uuid)
- rooms (store_uuid, room_uuid)
- rooms (store_uuid, room_no)
- sessions (store_uuid, room_uuid, session_status)
- sessions (store_uuid, business_date)
- orders (store_uuid, session_id)
- settlements (store_uuid, session_id)
- action_logs (store_uuid, business_date)

---

## 8. EXCLUDED FROM MVP ERD

이번 ERD에서 제외:
- BLE tags
- gateways
- chat rooms
- chat messages
- inventory stock movement
- advanced audit tables
- multi-store SaaS tenant abstraction
- high-complexity permission matrices

---

## 9. FINAL RULE

이 ERD가 잠기기 전에는
API 구현을 시작하지 않는다.

이 ERD를 무시하고 UI부터 만들지 않는다.
데이터 구조가 흔들리면
NOX 전체가 흔들린다.
