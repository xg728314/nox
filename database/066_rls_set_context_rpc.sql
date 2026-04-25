-- ============================================================
-- 066_rls_set_context_rpc.sql
--
-- RLS 3차 — app.store_uuid / app.is_super_admin GUC 주입용 RPC.
--
-- 구조적 사실:
--   Supabase-JS 의 PostgREST client 는 매 `.from(...).select(...)` 를
--   개별 HTTP 요청 + 개별 DB transaction 으로 실행한다.
--   `set_config(name, value, is_local=true)` 는 **transaction scope** 이므로
--   RPC 가 끝나는 순간 GUC 가 소멸한다. 즉 이 RPC 를 호출해도 **다음 번
--   `.from(...).select(...)` 질의는 GUC 가 이미 리셋된 상태**에서 실행된다.
--
--   그럼에도 이 RPC 가 의미가 있는 경우:
--     1) SECURITY DEFINER 로 작성된 다른 Postgres function 내부에서
--        가장 먼저 호출 → 해당 function 의 transaction 안에서 후속
--        SELECT 에 GUC 가 살아있음 (RLS policy 가 읽을 수 있음).
--     2) `is_local=false` 로 바꾸면 connection-scope 이지만, Supabase 의
--        transaction-pooler 특성상 다른 요청에 **leak** 가능성 → 사용 금지.
--
--   is_local=true 고정. 따라서 app 레벨에서 `.rpc('rls_set_context', ...)`
--   를 단독 호출하면 아무 효과 없음 (다음 JS-client 질의는 별도 transaction).
--   SECURITY DEFINER 래퍼 함수 패턴에서만 쓰일 수 있음.
--
-- 권한:
--   anon / authenticated / service_role 모두 EXECUTE 허용.
--   service_role 은 RLS BYPASS 라 무의미하지만, 호출 자체는 허용해 두어
--   공용 인프라 helper 로 활용 가능.
--
-- 삭제/재실행 안전:
--   CREATE OR REPLACE 로 멱등.
-- ============================================================

CREATE OR REPLACE FUNCTION rls_set_context(
  p_store_uuid uuid,
  p_is_super_admin boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- is_local=true: 현 transaction 범위만. 같은 transaction 안에서
  -- 뒤따르는 SELECT 가 이 GUC 를 참조할 수 있다.
  PERFORM set_config(
    'app.store_uuid',
    COALESCE(p_store_uuid::text, ''),
    true
  );
  PERFORM set_config(
    'app.is_super_admin',
    CASE WHEN p_is_super_admin THEN 'true' ELSE 'false' END,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION rls_set_context(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls_set_context(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_set_context(uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION rls_set_context(uuid, boolean) TO service_role;

COMMENT ON FUNCTION rls_set_context(uuid, boolean) IS
  'Set app.store_uuid + app.is_super_admin GUCs for the CURRENT transaction (is_local=true). Only meaningful inside other SECURITY DEFINER functions that read RLS-protected tables within the same transaction. JS-client standalone .rpc() call does NOT persist GUC across subsequent queries.';
