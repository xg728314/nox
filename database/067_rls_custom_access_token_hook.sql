-- ============================================================
-- 067_rls_custom_access_token_hook.sql
--
-- RLS 4차 — Supabase Auth Custom Access Token Hook.
--
-- 목적:
--   Supabase 가 JWT (access_token) 를 발급할 때마다 호출되는 훅 함수
--   `public.custom_access_token_hook(event jsonb) → jsonb`. 이 함수가
--   사용자의 primary approved membership 과 user_global_roles 를
--   읽어 JWT claims.app_metadata 에 `store_uuid` / `is_super_admin`
--   을 주입한다.
--
--   PostgREST 는 JWT 를 받으면 claims 를 `auth.jwt()` 로 노출. RLS policy
--   는 `(auth.jwt() -> 'app_metadata' ->> 'store_uuid')::uuid` 형태로
--   참조 가능.
--
-- Supabase 표준:
--   - 훅 시그니처: `custom_access_token_hook(event jsonb) RETURNS jsonb`
--     입력 `event`: { user_id, claims, authentication_method, ... }
--     출력: 수정된 `event` (claims 만 갱신).
--   - SECURITY DEFINER 로 실행 (auth.* / public.* 테이블 접근용).
--   - 실행 권한: `supabase_auth_admin` 에 GRANT EXECUTE.
--
-- 활성화 (이 migration 범위 외 — 운영자 수동 액션):
--   1) Supabase Dashboard → Authentication → Hooks → Custom Access Token
--      → Function: public.custom_access_token_hook 선택 → Enable
--   2) 또는 Supabase CLI / API 로 동일 설정.
--   3) 활성화 전까지 본 함수는 정의만 존재, JWT 는 기존 claims 그대로.
--
-- "기존 API 깨지지 않도록":
--   - 활성화 전: JWT 구조 불변 → 기존 동작 영향 0.
--   - 활성화 후: JWT 에 app_metadata.{store_uuid, is_super_admin} 추가.
--     기존 route 들은 service role 로 DB 를 조회하므로 JWT claim 증가에
--     무관. 새 RLS policy (068) 이 활성화된 경우에만 영향.
--   - 훅 실행 실패 시 Supabase 는 **JWT 발급을 중단** (로그인 불가) 하므로
--     함수 내부에 EXCEPTION 캐치 → 원본 event 그대로 반환으로 fail-safe.
--
-- 멱등: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_app_metadata jsonb;
  v_store_uuid uuid;
  v_is_super_admin boolean := false;
BEGIN
  -- event 구조:
  --   { "user_id": "...", "claims": {...}, "authentication_method": "password", ... }
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims := COALESCE(event -> 'claims', '{}'::jsonb);
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  IF v_user_id IS NULL THEN
    RETURN event;
  END IF;

  -- 1) primary approved membership → store_uuid
  SELECT store_uuid
    INTO v_store_uuid
  FROM public.store_memberships
  WHERE profile_id = v_user_id
    AND status = 'approved'
    AND is_primary = true
    AND deleted_at IS NULL
  LIMIT 1;

  -- 2) super_admin 역할 여부
  --    user_global_roles 테이블 존재 확인 후 읽기 (존재 안 하면 false 유지).
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_global_roles
      WHERE user_id = v_user_id
        AND role = 'super_admin'
    ) INTO v_is_super_admin;
  EXCEPTION WHEN undefined_table THEN
    v_is_super_admin := false;
  END;

  -- 3) app_metadata 에 주입 (기존 필드는 보존).
  v_app_metadata := v_app_metadata
    || jsonb_build_object(
         'store_uuid',     v_store_uuid,
         'is_super_admin', v_is_super_admin
       );

  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata, true);

  RETURN jsonb_set(event, '{claims}', v_claims, true);

EXCEPTION WHEN OTHERS THEN
  -- fail-safe: 어떤 오류라도 로그인 자체를 막지 않도록 원본 event 반환.
  -- (함수 실패 시 Supabase 가 로그인을 거부 → 운영 전체 마비 방지)
  RETURN event;
END;
$$;

-- Supabase 가 내부적으로 사용하는 `supabase_auth_admin` 역할에 실행 권한 부여.
-- (이 역할이 없는 환경에서는 GRANT 가 실패할 수 있음 — Supabase 가 아닌
--  raw Postgres 에서는 해당 역할 존재 확인 후 실행)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC';
  END IF;
END $$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'RLS-phase-4: Supabase Auth Custom Access Token Hook. Injects store_uuid + is_super_admin into JWT app_metadata from store_memberships + user_global_roles. Activation requires manual enable in Supabase Auth → Hooks dashboard.';
