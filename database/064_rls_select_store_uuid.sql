-- ============================================================
-- 064_rls_select_store_uuid.sql
--
-- RLS 1차 적용 — store_uuid 기반 SELECT policy.
--
-- 목적:
--   DB 레벨에서 store_uuid 기반 SELECT 접근을 정의. non-service-role
--   클라이언트 (anon / authenticated) 가 `app.store_uuid` GUC 를 설정
--   하지 않으면 해당 테이블에서 0 rows 를 반환.
--
-- 전제:
--   - Supabase service role 은 RLS 를 BYPASS 함 (기본). 현재 NOX 의 모든
--     API route 는 service role key 를 사용하므로 이 migration 은 경로
--     동작에 영향이 없다 (defense-in-depth 성격).
--   - `app.store_uuid` GUC 세팅 위치: 현 코드에 **없음**. 향후 라운드
--     에서 `resolveAuthContext` 성공 직후 `supabase.rpc('set_config',
--     {...})` 으로 주입 가능. 본 migration 은 세팅 경로를 **요구하지 않음**.
--
-- 스펙 지정 6개 테이블 중 3개만 포함, 3개는 스킵 (명시적 이유):
--
--   [APPLIED]
--     rooms              — store_uuid 컬럼 있음, 외부 anon/realtime 노출 없음
--     hostesses          — 동일
--     store_memberships  — 동일
--
--   [SKIPPED]
--     sessions           — 해당 이름의 테이블이 스키마에 없음
--                          (room_sessions 가 유사 기능)
--     room_sessions      — app/counter/hooks/useRooms.ts:224 에서 anon key
--                          로 realtime 구독 중. 제한 policy 적용 시
--                          카운터 realtime 이 0 이벤트로 degrade → "기존
--                          동작 깨지면 안됨" 규칙 위반 위험. 다음 라운드
--                          (anon/realtime 클라이언트에서 app.store_uuid
--                          세팅) 전까지 보류.
--     session_participants — 동일 (useRooms.ts:232 realtime 구독)
--     staff_work_logs    — 단일 store_uuid 컬럼 없음. origin_store_uuid +
--                          working_store_uuid dual column 구조 (059).
--                          스펙 literal policy (`store_uuid = ...`) 를
--                          그대로 적용 시 SQL 에러. dual-column 변형은
--                          "추측 금지" 규칙상 본 라운드 범위 외.
--
-- 기존 001 의 `disabled_for_mvp` policy (있을 수 있음) 는 DROP IF EXISTS
-- 로 안전 제거 (001 은 DEPRECATED 이지만 과거 prod 에 적용되었을 가능성).
--
-- 이 migration 은 idempotent (DROP IF EXISTS + CREATE POLICY 이름 고정).
-- WRITE (INSERT/UPDATE/DELETE) policy 는 추가하지 않음. 본 라운드는 SELECT 전용.
-- ============================================================

-- ── rooms ──────────────────────────────────────────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disabled_for_mvp" ON rooms;
DROP POLICY IF EXISTS "select_by_store_uuid" ON rooms;
CREATE POLICY "select_by_store_uuid"
  ON rooms
  FOR SELECT
  USING (store_uuid = current_setting('app.store_uuid', true)::uuid);

-- ── hostesses ──────────────────────────────────────────────
ALTER TABLE hostesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disabled_for_mvp" ON hostesses;
DROP POLICY IF EXISTS "select_by_store_uuid" ON hostesses;
CREATE POLICY "select_by_store_uuid"
  ON hostesses
  FOR SELECT
  USING (store_uuid = current_setting('app.store_uuid', true)::uuid);

-- ── store_memberships ──────────────────────────────────────
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disabled_for_mvp" ON store_memberships;
DROP POLICY IF EXISTS "select_by_store_uuid" ON store_memberships;
CREATE POLICY "select_by_store_uuid"
  ON store_memberships
  FOR SELECT
  USING (store_uuid = current_setting('app.store_uuid', true)::uuid);

-- 위 3 테이블에 대한 WRITE (INSERT/UPDATE/DELETE) policy 는 이 라운드에서
-- 정의하지 않음. service role 은 기본 BYPASS RLS 로 기존과 동일하게 동작.
-- non-service-role 에서 WRITE 시도는 policy 부재로 거부되지만, 현재 NOX
-- 는 service role 로만 WRITE 하므로 영향 없음.
