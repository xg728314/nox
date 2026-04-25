-- ============================================================
-- 072_rls_session_participants_jwt.sql  (DRAFT — not yet applied)
--
-- RLS 8차 — session_participants 를 JWT claim 기반 SELECT 로 보호.
--
-- 스키마 근거:
--   002_actual_schema.sql:179-200  (base table)
--   009_cross_store_settlement.sql:23  (ALTER 로 origin_store_uuid 추가)
--
--   session_participants (
--     id, session_id → room_sessions(id),
--     store_uuid   UUID NOT NULL,       ← 실제 근무매장 (working store)
--     origin_store_uuid UUID NULL,       ← 9로 추가된 cross-store 원소속
--     membership_id, manager_membership_id, transfer_request_id,
--     role, category, time_minutes, price_amount,
--     manager_payout_amount, hostess_payout_amount, margin_amount,
--     status DEFAULT 'active',
--     entered_at, left_at, memo, created_at, updated_at, deleted_at
--   )
--
-- cross-store 설계 맥락 (CLAUDE.md L133-135):
--   "아가씨는 원소속 매장(origin_store_uuid)에 영원히 귀속. 워킹매장은
--    장소만 제공, 수수료 없음. 정산은 무조건 origin_store_uuid 기준."
--   →  working store (store_uuid) 는 운영 대시보드에서 "지금 내 매장에서
--      일하는 사람" 을 봐야 함 — realtime 구독 축.
--   →  origin store (origin_store_uuid) 는 정산/트래킹을 위해 "우리 소속이
--      다른 매장에서 일한 기록" 을 봐야 함 — REST 집계 축.
--
-- 정책 3종 (070 cross_store_work_records 와 유사 분리 패턴):
--
--   J1  select_jwt_working_scope
--        → store_uuid = JWT.store_uuid
--        → 워킹매장 full visibility (realtime 축, 현 useRooms 구독 통과).
--
--   J2  select_jwt_origin_scope_cross_store
--        → origin_store_uuid = JWT.store_uuid
--        → AND store_uuid <> origin_store_uuid   (자기 매장은 J1 으로 이미 커버)
--        → origin 이 해당 row 의 원소속일 때만. 같은 매장 row 는 J1 경로.
--        → 정산/리포트용 REST 조회 축.
--
--   J3  select_jwt_super_admin
--        → JWT app_metadata.is_super_admin=true → 전 row.
--
-- J1 ∪ J2 ∪ J3 union 으로 동작. 단순 OR (store_uuid IN (…, origin)) 와 달리
-- 정책 단위 감사/해지 가능. J1 은 realtime 필수 경로라 분리 보존.
--
-- NULL-safety:
--   - JWT claim NULL → UUID 캐스트 NULL → `… = NULL` UNKNOWN → row 제외.
--   - origin_store_uuid 가 NULL 인 row (cross-store 아님) → J2 의
--     `origin_store_uuid = claim` = `NULL = claim` UNKNOWN → J2 비활성,
--     J1 / J3 로만 평가. 의도된 동작.
--
-- WRITE policy 미정의. service_role BYPASSRLS.
-- idempotent: DROP IF EXISTS + CREATE POLICY.
-- ============================================================

ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disabled_for_mvp"                        ON session_participants;
DROP POLICY IF EXISTS "select_jwt_store_uuid"                   ON session_participants;
DROP POLICY IF EXISTS "select_jwt_working_scope"                ON session_participants;
DROP POLICY IF EXISTS "select_jwt_origin_scope_cross_store"     ON session_participants;
DROP POLICY IF EXISTS "select_jwt_super_admin"                  ON session_participants;

-- ── J1: working scope ──────────────────────────────────────────
CREATE POLICY "select_jwt_working_scope"
  ON session_participants
  FOR SELECT
  USING (
    session_participants.store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

-- ── J2: origin scope (cross-store 만) ──────────────────────────
CREATE POLICY "select_jwt_origin_scope_cross_store"
  ON session_participants
  FOR SELECT
  USING (
    session_participants.origin_store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
    AND session_participants.origin_store_uuid IS DISTINCT FROM session_participants.store_uuid
  );

-- ── J3: super_admin bypass ─────────────────────────────────────
CREATE POLICY "select_jwt_super_admin"
  ON session_participants
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_working_scope" ON session_participants IS
  'RLS-phase-8: store_uuid = JWT app_metadata.store_uuid. realtime 구독 축 (useRooms).';
COMMENT ON POLICY "select_jwt_origin_scope_cross_store" ON session_participants IS
  'RLS-phase-8: origin_store_uuid = JWT app_metadata.store_uuid AND row 이 cross-store 인 경우만. 정산/리포트용.';
COMMENT ON POLICY "select_jwt_super_admin" ON session_participants IS
  'RLS-phase-8: JWT app_metadata.is_super_admin=true → 전 row.';
