-- ============================================================
-- 065_rls_staff_work_logs_select.sql
--
-- RLS 2차 — staff_work_logs SELECT 정책.
--
-- Phase 1 (064) 은 `store_uuid` 단일 컬럼 스킴만 처리. staff_work_logs 는
-- origin_store_uuid + working_store_uuid dual column 구조 (059) 라 별도
-- 설계가 필요. 아래 3개 policy 로 분리한다 (단순 OR 아님).
--
--   P1  select_origin_scope            — home store 전수 읽기 (draft/confirmed/disputed/settled/voided 전부)
--   P2  select_working_scope_dispute    — working store 는 status ∈ (confirmed, disputed) 일 때만
--   P3  select_super_admin_bypass       — app.is_super_admin='true' GUC 바이패스
--
-- 이 분리는 실제 lifecycle gate (lib/server/queries/staffWorkLogLifecycle.ts)
-- 와 정렬됨:
--
--   checkBaseLifecycleGate (confirm / void)
--     → non-super_admin 은 origin_store_uuid 일치 필요        → P1 이 해당 범위 커버
--   checkResolvable (resolve)
--     → 동일 (disputed → confirmed 는 origin 전용)             → P1
--   checkDisputeScopeGate (dispute)
--     → origin OR working 허용, 단 status='confirmed' 필수     → P1 ∪ P2
--
-- working store 에게 voided/draft/settled 를 노출하지 않는 이유:
--   - draft: origin 만 초안 소유. working 이 볼 필요 없음.
--   - settled: 이미 cross_store_settlement_items 로 편입됨. 정산 view 에서
--              정상 조회됨. staff_work_logs row 자체는 origin 기록물.
--   - voided: 원천 기록이 취소됨. working 이 접근하면 재분쟁 유도 가능성.
--   - confirmed: dispute 대상. working 이 인지하고 이의제기 할 수 있어야.
--   - disputed: working 이 이의를 건 상태. 진행 추적 위해 필요.
--
-- 전제 (064 와 동일):
--   - service role 은 RLS 를 BYPASS 함. 현재 모든 API route 는 service role
--     사용 → 본 migration 은 경로 동작 영향 없음 (defense-in-depth).
--   - `app.store_uuid`, `app.is_super_admin` GUC 는 현재 코드 어디에서도
--     설정하지 않음. 향후 anon/authenticated 전환 시 setContext 주입 지점
--     설계 필요 (resolveAuthContext 직후 권장).
--
-- NULL GUC 시 차단:
--   - `current_setting('app.store_uuid', true)` → NULL → ::uuid 캐스트도 NULL
--     → `col = NULL` 은 UNKNOWN → row 제외.
--   - `current_setting('app.is_super_admin', true)` → NULL → `NULL = 'true'`
--     → UNKNOWN → super_admin policy 미활성.
--
-- WRITE (INSERT/UPDATE/DELETE) policy 는 추가하지 않음 (2차 라운드도 READ 전용).
--
-- idempotent: DROP IF EXISTS + CREATE POLICY 이름 고정.
-- ============================================================

ALTER TABLE staff_work_logs ENABLE ROW LEVEL SECURITY;

-- 레거시 잔존 cleanup (있을 수 있음)
DROP POLICY IF EXISTS "disabled_for_mvp" ON staff_work_logs;
DROP POLICY IF EXISTS "select_by_store_uuid" ON staff_work_logs;

-- 본 라운드 3 policy cleanup (idempotency)
DROP POLICY IF EXISTS "select_origin_scope" ON staff_work_logs;
DROP POLICY IF EXISTS "select_working_scope_dispute_state" ON staff_work_logs;
DROP POLICY IF EXISTS "select_super_admin_bypass" ON staff_work_logs;

-- ── P1: origin scope (home store) — 전 lifecycle 상태 가시성 ─────
CREATE POLICY "select_origin_scope"
  ON staff_work_logs
  FOR SELECT
  USING (
    origin_store_uuid = current_setting('app.store_uuid', true)::uuid
  );

-- ── P2: working scope — dispute 관련 상태만 ────────────────────
--   checkDisputeScopeGate 의 application-layer 의미를 DB 레벨에서 mirror.
--   working store 는 confirmed (dispute 대상) / disputed (진행 추적) 만.
--   draft / settled / voided 는 origin-private.
CREATE POLICY "select_working_scope_dispute_state"
  ON staff_work_logs
  FOR SELECT
  USING (
    working_store_uuid = current_setting('app.store_uuid', true)::uuid
    AND status IN ('confirmed', 'disputed')
  );

-- ── P3: super_admin GUC 바이패스 ────────────────────────────────
--   RLS 는 policy union → 본 policy 가 만족되면 다른 policy 무관하게 전수
--   가시. service role 바이패스와 별개 (authenticated role 이 admin 권한
--   으로 조회 시 GUC 로 명시).
CREATE POLICY "select_super_admin_bypass"
  ON staff_work_logs
  FOR SELECT
  USING (
    current_setting('app.is_super_admin', true) = 'true'
  );

COMMENT ON POLICY "select_origin_scope" ON staff_work_logs IS
  'Read: origin store (hostess home) sees every lifecycle status.';
COMMENT ON POLICY "select_working_scope_dispute_state" ON staff_work_logs IS
  'Read: working store sees only confirmed/disputed rows — dispute lifecycle window.';
COMMENT ON POLICY "select_super_admin_bypass" ON staff_work_logs IS
  'Read: super_admin GUC bypass — set app.is_super_admin=true.';
