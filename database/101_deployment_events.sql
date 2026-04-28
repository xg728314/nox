-- 101_deployment_events.sql
-- R-Ver (2026-04-28): Cloud Run revision 별 첫 가동 시각 누적.
--
-- 목적:
--   1) 카운터 화면 배지에 "오늘 N번 배포" 표시
--   2) 사고 발생 시 "어느 revision 부터 터졌는지" 빠른 추적
--   3) /admin/deployments 페이지 (owner) 통계
--
-- 채우기 메커니즘:
--   /api/system/version 첫 호출 시 자동 UPSERT.
--   revision 컬럼 UNIQUE 라 race condition 시에도 1 row 만 생성 (idempotent).
--
-- 의도적 제약:
--   - hard delete 없음 (감사 추적)
--   - 매장 스코프 없음 (시스템 단위 정보, store_uuid 없음)
--   - RLS 비활성: 시스템 정보라 매장 무관, /api/system/version 가 무인증 endpoint

CREATE TABLE IF NOT EXISTS deployment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision        text NOT NULL UNIQUE,                /* 'nox-00080-wcg' */
  service         text NOT NULL,                       /* 'nox' */
  region          text,                                /* 'asia-northeast3' */
  git_sha         text,
  git_short_sha   text,
  git_message     text,                                /* 첫 줄만 */
  built_at        timestamptz,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),  /* 첫 인스턴스 깨어난 시각 */
  build_id        text,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_deployment_events_first_seen
  ON deployment_events (first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_deployment_events_git_sha
  ON deployment_events (git_sha)
  WHERE git_sha IS NOT NULL;

COMMENT ON TABLE deployment_events IS
  'R-Ver: Cloud Run revision 별 첫 가동 시각. /api/system/version 가 첫 호출 시 idempotent UPSERT.';
