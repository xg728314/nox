-- 055_grant_super_admin.sql
--
-- 운영자 계정에 super_admin 글로벌 역할 부여.
--
-- 원칙:
--   - 앱 코드는 `auth.is_super_admin` 만 참조 (lib/auth/resolveAuthContext.ts).
--   - 이메일 문자열은 이 migration 파일 내부에서만 존재.
--   - DO 블록이 auth.users 조회에 실패하면 RAISE EXCEPTION 으로 즉시
--     중단되어, 잘못된 이메일로 빈 grant 가 만들어질 수 없다.
--
-- ⚠️ DBA 필수 사전 확인:
--   아래 target_email 이 실 운영자 이메일과 일치하는지 확인 후 apply.
--   혼선 이력: 태스크 문서에 'xg72314@gmail.com' 과
--   'xg728314@gmail.com' 두 버전이 공존. CLAUDE.md 가 운영자 이메일을
--   'xg728314@gmail.com' 으로 기록하고 있으므로 기본값 채택.
--
-- 참조:
--   orchestration/tasks/ble-monitor-final-extension.md [ADMIN / SUPER ADMIN ACCESS]

DO $grant$
DECLARE
  target_email text := 'xg728314@gmail.com';  -- DBA 확인 후 필요 시 교체
  target_uid   uuid;
BEGIN
  SELECT u.id
    INTO target_uid
  FROM auth.users u
  WHERE lower(u.email) = lower(target_email)
  LIMIT 1;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION
      'auth.users row not found for email=% — aborting super_admin grant. Confirm the actual operator email before re-running.',
      target_email;
  END IF;

  INSERT INTO public.user_global_roles (user_id, role, status, created_at)
  VALUES (target_uid, 'super_admin', 'approved', now())
  ON CONFLICT (user_id, role) DO UPDATE
    SET status = 'approved',
        deleted_at = NULL;

  RAISE NOTICE 'super_admin granted to user_id=% (email=%)', target_uid, target_email;
END;
$grant$;
