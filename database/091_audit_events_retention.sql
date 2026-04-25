-- 091_audit_events_retention.sql
-- R26 (2026-04-25): audit_events 무한 성장 차단 + 콜드 보관.
--
-- 문제: audit_events 는 모든 mutation 마다 1 row. 추정 1000건/매장/월 ×
--   14매장 × 12개월 = 168K/년. 빠른 성장 아니지만 5년 후 ~840K, hot-path
--   인덱스(086) 와 합쳐 쿼리 지연 위험. 회계법상 보관 5년.
--
-- 해결: hot 테이블은 90일 retention. 90일 초과는 audit_events_archive 로
--   COPY-DELETE. archive 테이블은 동일 schema + archived_at 한 컬럼 추가.
--   archive 는 인덱스 최소화 (PK + created_at) — 조회는 드물고 보관용.
--
-- 호출자: app/api/cron/audit-archive (R26 신규 cron, 일 1회 03:30 KST).
-- 임계: 90일. 변경 시 lib/automation/cronHeartbeat.ts 의 schedule 과 동기화.

CREATE TABLE IF NOT EXISTS audit_events_archive (
  id                   uuid PRIMARY KEY,
  store_uuid           uuid NOT NULL,
  actor_profile_id     uuid NOT NULL,
  actor_membership_id  uuid,
  actor_role           text NOT NULL,
  actor_type           text,
  session_id           uuid,
  room_uuid            uuid,
  entity_table         text NOT NULL,
  entity_id            uuid NOT NULL,
  action               text NOT NULL,
  before               jsonb,
  after                jsonb,
  reason               text,
  created_at           timestamptz NOT NULL,
  archived_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_events_archive IS
  'R26: hot audit_events 의 90일 초과분 콜드 보관. 회계법 5년 보관 + 분쟁 증빙용.';

-- 콜드 테이블엔 FK 안 검. (참조 row 가 hot 에서 cascade 로 삭제될 수 있음 — 그래도 audit 흔적은 보존돼야 함.)

-- 보관용이라 인덱스 최소화. created_at + (store, action) 조회만 가끔.
CREATE INDEX IF NOT EXISTS idx_audit_archive_created_at
  ON audit_events_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_archive_store_action
  ON audit_events_archive (store_uuid, action, created_at DESC);

ALTER TABLE audit_events_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_archive_service_only ON audit_events_archive;
CREATE POLICY audit_archive_service_only ON audit_events_archive
  FOR ALL TO public
  USING (false) WITH CHECK (false);

-- ─── 이동 RPC ────────────────────────────────────────────────────
-- 단일 트랜잭션에서 INSERT + DELETE. 부분 실패 시 전체 롤백.
-- batch_size 로 한번에 처리할 row 수 제한 (cron 타임아웃 회피).
-- 반환: 실제 이동된 row 수.
CREATE OR REPLACE FUNCTION archive_audit_events(
  cutoff_ts timestamptz,
  batch_size int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  moved int;
BEGIN
  WITH picked AS (
    SELECT id
    FROM audit_events
    WHERE created_at < cutoff_ts
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ),
  inserted AS (
    INSERT INTO audit_events_archive (
      id, store_uuid, actor_profile_id, actor_membership_id, actor_role,
      actor_type, session_id, room_uuid, entity_table, entity_id, action,
      before, after, reason, created_at
    )
    SELECT
      e.id, e.store_uuid, e.actor_profile_id, e.actor_membership_id, e.actor_role,
      e.actor_type, e.session_id, e.room_uuid, e.entity_table, e.entity_id, e.action,
      e.before, e.after, e.reason, e.created_at
    FROM audit_events e
    JOIN picked p ON p.id = e.id
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  )
  DELETE FROM audit_events
  WHERE id IN (SELECT id FROM inserted);

  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END;
$$;

REVOKE ALL ON FUNCTION archive_audit_events(timestamptz, int) FROM public;
-- service-role 만 호출 (RLS 우회). 명시적 grant 불필요 — service-role 는
-- 모든 function 호출 권한 보유.
