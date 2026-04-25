-- 086_hotpath_indexes.sql
-- 2026-04-24: 6~8층 확장 시 트래픽 증가 대비 고빈도 쿼리 인덱스 보강.
--
-- 선정 기준: app/api/**/route.ts 스캔 결과 실제 사용 패턴.
--   1. session_participants — (store_uuid, status) 복합 필터가 자주 쓰임.
--      active 만 필터링하는 count/sum 이 많음.
--   2. orders — session_id + store_uuid 로 자주 조회 (bill/settlement).
--   3. audit_events — store_uuid + created_at DESC (감사 대시보드).
--   4. cross_store_work_records — origin_store_uuid + business_day_id
--      (정산 집계).
--   5. room_sessions — store_uuid + status + archived_at (주기적 폴링).
--
-- 원칙:
--   - 파셜 인덱스(WHERE deleted_at IS NULL) 로 dead row 제외해서 크기 최소화.
--   - CREATE INDEX IF NOT EXISTS 로 멱등.
--   - ONLINE 생성 (CONCURRENTLY) 은 PostgreSQL 자체 제약으로 BEGIN 밖 필요.
--     Supabase SQL Editor 환경에서는 보통 파일 단위 트랜잭션 감싸지므로
--     여기선 일반 CREATE INDEX 사용 (소규모 테이블 전제).

-- ── session_participants ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sp_store_status_active
  ON session_participants (store_uuid, status)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_sp_session_active
  ON session_participants (session_id)
  WHERE deleted_at IS NULL AND status IN ('active', 'mid_out');

-- ── orders ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_session_active
  ON orders (session_id, store_uuid)
  WHERE deleted_at IS NULL;

-- ── audit_events ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_events_store_created
  ON audit_events (store_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events (store_uuid, action, created_at DESC);

-- ── cross_store_work_records ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cswr_origin_busday
  ON cross_store_work_records (origin_store_uuid, business_day_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cswr_working_busday
  ON cross_store_work_records (working_store_uuid, business_day_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cswr_session
  ON cross_store_work_records (session_id)
  WHERE deleted_at IS NULL;

-- ── receipts ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_receipts_session_version
  ON receipts (session_id, version DESC);

-- ── credits ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credits_store_status
  ON credits (store_uuid, status)
  WHERE deleted_at IS NULL;

-- ── pre_settlements ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pre_settlements_session_active
  ON pre_settlements (session_id)
  WHERE deleted_at IS NULL AND status = 'active';

-- ── store_operating_days ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sod_store_date
  ON store_operating_days (store_uuid, business_date DESC)
  WHERE deleted_at IS NULL;

-- ── store_memberships (자주 사용되는 role/status 필터) ─────
CREATE INDEX IF NOT EXISTS idx_sm_store_role_status
  ON store_memberships (store_uuid, role, status)
  WHERE deleted_at IS NULL;
