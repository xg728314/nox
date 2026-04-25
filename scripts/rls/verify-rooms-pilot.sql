-- ============================================================
-- verify-rooms-pilot.sql
--
-- RLS 5차 — rooms JWT pilot E2E 검증 harness.
--
-- 실행:
--   Supabase Dashboard → SQL Editor 에 붙여넣기, 아래 2개 UUID 를 운영
--   스토어로 치환 후 실행.
--
--   :store_a_uuid = 테스트 기준 매장 (권한 부여 scope)
--   :store_b_uuid = 다른 매장 (차단 확인용)
--
-- 사전조건:
--   1) migration 064 / 067 / 068 이 프로덕션 DB 에 적용되어 있어야 함.
--   2) Custom Access Token Hook 은 pilot 검증 용도라면 enable 여부 무관
--      (본 script 는 set_config 로 JWT claim 을 시뮬한다).
--   3) 로그인 실 JWT 를 이용한 추가 검증은 별도 Node 스크립트 필요 —
--      본 script 는 SQL 레벨에서 RLS evaluate 경로를 확인하는 용도.
--
-- 어떻게 JWT claim 을 시뮬하는가:
--   Supabase 의 `auth.jwt()` 는 내부적으로
--     `nullif(current_setting('request.jwt.claims', true), '')::jsonb`
--   를 반환. set_config 로 이 GUC 를 직접 세팅하면 `auth.jwt()` 가
--   우리가 준 JSON 을 반환 → 068 policy 가 그대로 평가됨.
--
-- 어떻게 role 별 차이를 확인하는가:
--   - `SET LOCAL ROLE authenticated` → service_role BYPASS 제외, RLS 정상 평가
--   - `SET LOCAL ROLE anon`           → 마찬가지로 RLS 정상 평가
--   - `RESET ROLE` 또는 `service_role` → BYPASSRLS
--
-- 주의:
--   이 script 는 **read-only**. 어떤 mutation 도 수행하지 않는다.
--   각 SELECT 를 RAISE NOTICE 로 건수만 찍는다. 실데이터 노출 없음.
-- ============================================================

-- ── 사전 셋업: 테스트 대상 UUID 입력 ────────────────────────
-- 운영자가 아래 2줄을 실제 store UUID 로 치환.
\set store_a_uuid '\'00000000-0000-0000-0000-000000000000\''
\set store_b_uuid '\'00000000-0000-0000-0000-000000000001\''

-- ============================================================
-- TEST 1 — same-store read (authed + 정상 JWT claim)
--   기대: rooms.where(store_uuid = store_a) 건수 > 0 (실제 보유 수)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'app_metadata', jsonb_build_object(
        'store_uuid', :store_a_uuid,
        'is_super_admin', false
      )
    )::text,
    true);
  SELECT count(*) INTO v_count FROM public.rooms
    WHERE store_uuid = :store_a_uuid::uuid;
  RAISE NOTICE '[T1] same-store (A) read authed + JWT(A) → rows = %', v_count;
END $$;

-- ============================================================
-- TEST 2 — cross-store attempt (authed + JWT(A) 이지만 store_b 쿼리)
--   기대: 0 rows (policy 차단)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'app_metadata', jsonb_build_object(
        'store_uuid', :store_a_uuid,
        'is_super_admin', false
      )
    )::text,
    true);
  SELECT count(*) INTO v_count FROM public.rooms
    WHERE store_uuid = :store_b_uuid::uuid;
  RAISE NOTICE '[T2] cross-store read authed + JWT(A) on store_b → rows = % (expect 0)', v_count;
END $$;

-- ============================================================
-- TEST 3 — JWT 없음 / 빈 claim (authed)
--   기대: 0 rows (app_metadata.store_uuid NULL → policy 차단)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_count FROM public.rooms;
  RAISE NOTICE '[T3] authed + empty JWT → rows = % (expect 0)', v_count;
END $$;

-- ============================================================
-- TEST 4 — anon 역할 + JWT 없음
--   기대: 0 rows (policy 차단)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_count FROM public.rooms;
  RAISE NOTICE '[T4] anon + empty JWT → rows = % (expect 0)', v_count;
END $$;

-- ============================================================
-- TEST 5 — super_admin claim (authed + is_super_admin=true)
--   기대: 전체 rooms 반환
-- ============================================================
DO $$
DECLARE v_count_all int; v_count_b int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'app_metadata', jsonb_build_object(
        'store_uuid', NULL,
        'is_super_admin', true
      )
    )::text,
    true);
  SELECT count(*) INTO v_count_all FROM public.rooms;
  SELECT count(*) INTO v_count_b   FROM public.rooms
    WHERE store_uuid = :store_b_uuid::uuid;
  RAISE NOTICE '[T5] authed + super_admin JWT → total rows = %, store_b rows = % (expect > 0 if store_b has rooms)', v_count_all, v_count_b;
END $$;

-- ============================================================
-- TEST 6 — service role (RESET ROLE = 세션 기본 = supabase admin)
--   기대: RLS BYPASS → 전체 rooms 반환. 기존 API 와 동일.
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.rooms;
  RAISE NOTICE '[T6] default session role (service/postgres) → rows = % (expect ALL — BYPASSRLS)', v_count;
END $$;

-- ============================================================
-- TEST 7 — 068 이 064 와 OR union 으로 공존하는지 확인
--   시나리오: authed, JWT 없음, BUT app.store_uuid GUC 세팅 (064 경로)
--   기대: 064 의 `current_setting('app.store_uuid')` 정책이 매칭 → rows > 0
--   (064 policy 가 아직 pilot 과 함께 살아있음을 증명)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.store_uuid', :store_a_uuid, true);
  SELECT count(*) INTO v_count FROM public.rooms
    WHERE store_uuid = :store_a_uuid::uuid;
  RAISE NOTICE '[T7] authed + app.store_uuid GUC only (064 legacy) → rows = % (expect > 0 if store_a has rooms)', v_count;
END $$;

-- ============================================================
-- 정리: 세션 상태 복구
-- ============================================================
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT set_config('app.store_uuid', '', false);
SELECT set_config('app.is_super_admin', '', false);
