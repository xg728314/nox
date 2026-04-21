# NOX DB SCHEMA SOURCE (LOCKED)

> **진실의 원천 (Single Source of Truth)**
> 실제 Supabase DB 스키마는 `database/002_actual_schema.sql`이다.
> 이 파일은 2026-04-11 Supabase REST API OpenAPI spec에서 추출한 것으로,
> 21개 테이블의 컬럼, 타입, FK, 기본값을 모두 포함한다.
> 기존 `database/001_initial_schema.sql`은 폐기(DEPRECATED)되었으며 참조 금지.

이 문서는 실제 구현할 DB 스키마 기준이다.
커서 FOXPRO87 실운영 검증 구조 기반.
변경 시 NOX_PROJECT_TRUTH.md 원칙과 반드시 대조.

## 설계 원칙
- PK: UUID (gen_random_uuid())
- 모든 업무 테이블: store_uuid 필수
- 모든 테이블: created_at / updated_at 필수
- soft delete: deleted_at (nullable)
- 직접 INSERT/UPDATE/DELETE 금지 (RPC 경유)
- audit_events: INSERT only (append-only)

## 테이블 목록

### stores
- id uuid PK
- store_uuid uuid UNIQUE (= id, 보안 scope 기준)
- store_name text NOT NULL (표시용)
- store_code text (표시용만, 로직 사용 금지)
- floor integer (5~8)
- is_active boolean DEFAULT true
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### rooms
- id uuid PK (= room_uuid)
- store_uuid uuid NOT NULL → stores.id
- room_no text NOT NULL (표시용만)
- room_name text
- floor_no integer
- sort_order integer DEFAULT 0
- is_active boolean DEFAULT true
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()
- UNIQUE(store_uuid, room_no)

### profiles
- id uuid PK (= auth.users.id)
- full_name text
- phone text
- nickname text
- is_active boolean DEFAULT true
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()
(store_uuid 없음 - 글로벌 테이블)

### store_memberships
- id uuid PK (= membership_id)
- profile_id uuid NOT NULL → profiles.id
- store_uuid uuid NOT NULL → stores.id
- role text NOT NULL (owner/manager/hostess)
- status text DEFAULT 'pending' (pending/approved/rejected/suspended)
- is_primary boolean DEFAULT true
- approved_by uuid → profiles.id
- approved_at timestamptz
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### managers
- id uuid PK
- store_uuid uuid NOT NULL → stores.id
- membership_id uuid NOT NULL → store_memberships.id
- name text NOT NULL
- nickname text
- phone text
- is_active boolean DEFAULT true
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### hostesses
- id uuid PK
- store_uuid uuid NOT NULL → stores.id
- membership_id uuid NOT NULL → store_memberships.id
- manager_id uuid → managers.id
- name text NOT NULL
- stage_name text
- category text
- phone text
- is_active boolean DEFAULT true
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### store_operating_days
- id uuid PK (= business_day_id)
- store_uuid uuid NOT NULL → stores.id
- business_date date NOT NULL
- status text DEFAULT 'open' (open/closed)
- opened_at timestamptz DEFAULT now()
- closed_at timestamptz
- opened_by uuid → profiles.id
- closed_by uuid → profiles.id
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()
- UNIQUE(store_uuid, business_date)

### room_sessions
- id uuid PK (= session_id)
- store_uuid uuid NOT NULL → stores.id
- room_uuid uuid NOT NULL → rooms.id
- business_day_id uuid → store_operating_days.id
- status text (active/closed/void)
- started_at timestamptz DEFAULT now()
- ended_at timestamptz
- opened_by uuid → profiles.id
- closed_by uuid → profiles.id
- notes text
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()
- UNIQUE(room_uuid) WHERE status='active'

### session_participants
- id uuid PK
- session_id uuid NOT NULL → room_sessions.id
- store_uuid uuid NOT NULL → stores.id (세션 발생 가게)
- membership_id uuid NOT NULL → store_memberships.id
- role text NOT NULL (manager/hostess)
- category text (퍼블릭/셔츠/하퍼/차3)
- time_minutes integer DEFAULT 0
- price_amount integer DEFAULT 0
- manager_payout_amount integer DEFAULT 0
- hostess_payout_amount integer DEFAULT 0
- margin_amount integer DEFAULT 0
- status text DEFAULT 'active' (active/left)
- entered_at timestamptz DEFAULT now()
- left_at timestamptz
- memo text
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### orders
- id uuid PK
- session_id uuid NOT NULL → room_sessions.id
- store_uuid uuid NOT NULL → stores.id
- item_name text
- order_type text
- qty integer DEFAULT 1
- unit_price integer DEFAULT 0
- amount integer
- ordered_by uuid → profiles.id
- notes text
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### store_settings
- id uuid PK
- store_uuid uuid NOT NULL UNIQUE → stores.id
- tc_rate numeric DEFAULT 0.2
- manager_payout_rate numeric DEFAULT 0.7
- hostess_payout_rate numeric DEFAULT 0.1
- payout_basis text DEFAULT 'netOfTC'
- rounding_unit integer DEFAULT 1000
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### receipts
- id uuid PK
- session_id uuid NOT NULL → room_sessions.id
- store_uuid uuid NOT NULL → stores.id
- gross_total integer DEFAULT 0
- tc_amount integer DEFAULT 0
- manager_amount integer DEFAULT 0
- hostess_amount integer DEFAULT 0
- margin_amount integer DEFAULT 0
- order_total_amount integer DEFAULT 0
- participant_total_amount integer DEFAULT 0
- discount_amount integer DEFAULT 0
- service_amount integer DEFAULT 0
- status text DEFAULT 'draft' (draft/finalized)
- finalized_at timestamptz
- finalized_by uuid → profiles.id
- snapshot jsonb DEFAULT '{}'
- created_at timestamptz DEFAULT now()
- updated_at timestamptz DEFAULT now()

### receipt_snapshots
- id uuid PK
- session_id uuid NOT NULL → room_sessions.id
- store_uuid uuid NOT NULL → stores.id
- room_uuid uuid NOT NULL → rooms.id
- snapshot jsonb NOT NULL
- created_by uuid → profiles.id
- created_at timestamptz DEFAULT now()
(append-only)

### closing_reports
- id uuid PK
- store_uuid uuid NOT NULL → stores.id
- business_day_id uuid NOT NULL → store_operating_days.id
- status text DEFAULT 'confirmed'
- summary jsonb DEFAULT '{}'
- notes text
- created_by uuid → profiles.id
- confirmed_by uuid → profiles.id
- created_at timestamptz DEFAULT now()
- confirmed_at timestamptz DEFAULT now()

### audit_events
- id uuid PK
- store_uuid uuid NOT NULL → stores.id
- actor_profile_id uuid NOT NULL → profiles.id
- actor_role text NOT NULL
- actor_type text (owner/manager/hostess/counter)
- session_id uuid → room_sessions.id
- room_uuid uuid → rooms.id
- entity_table text NOT NULL
- entity_id uuid NOT NULL
- action text NOT NULL
- before jsonb
- after jsonb
- reason text
- created_at timestamptz DEFAULT now()
(INSERT only, UPDATE/DELETE 금지)

## RLS 기본 원칙
- store_uuid 기준 접근 통제
- admin: 전체 접근
- owner/manager/hostess: 자기 store만
- audit_events: INSERT only 정책
- receipt_snapshots: INSERT only 정책

## 금지
- room_no로 조회 금지
- store_code를 FK로 사용 금지
- numeric store_id 사용 금지
- calendar date 직접 집계 금지
- audit_events UPDATE/DELETE 금지
