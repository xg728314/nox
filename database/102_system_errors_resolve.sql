-- 102_system_errors_resolve.sql
--
-- 시스템 에러 모니터에 active/resolved 구분 + 자동 정리 메커니즘 추가.
--
-- 배경:
--   2026-04-28 시점 system_errors 테이블에 stale 한 dev ChunkLoadError 와
--   현재도 발생 중인 production 에러 (예: [supabaseClient] Missing
--   NEXT_PUBLIC_SUPABASE_URL) 가 섞여 있어서 owner 가 "지금도 일어나는
--   에러" 와 "과거 에러" 를 구분 못 함.
--
-- 변경:
--   1) resolved_at, resolved_by 컬럼 추가. NULL = active, 값 = 해결됨.
--   2) (resolved_at, created_at) 부분 인덱스 — active 우선 조회 빠르게.
--   3) (tag, error_name, error_message) 그룹 조회용 인덱스.
--
-- 운영 흐름:
--   - 수동 해결: owner 가 UI 에서 "✓ 해결됨" 클릭 → POST /api/telemetry/errors/resolve
--     → 같은 (tag, error_name, error_message) 묶음 전체에 resolved_at 스탬프.
--   - 자동 해결: cron (system-errors-cleanup) 이 6h 동안 동일 fingerprint
--     재발 없으면 resolved_at = now() 로 마킹.
--   - 자동 삭제: 같은 cron 이 resolved_at < now() - 30d 인 행을 hard delete.
--
-- 호환:
--   - 기존 INSERT 호출자 (login route, telemetry capture) 는 변경 불필요.
--     resolved_at 미지정 → NULL = active.
--   - 기존 GET /api/telemetry/errors 응답 shape 은 라우트에서 호환 유지.

ALTER TABLE public.system_errors
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resolved_by uuid NULL;

-- Active 우선 조회: WHERE resolved_at IS NULL ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_system_errors_active_recent
  ON public.system_errors (created_at DESC)
  WHERE resolved_at IS NULL;

-- Resolved cleanup 조회: WHERE resolved_at < now() - 30d
CREATE INDEX IF NOT EXISTS idx_system_errors_resolved_at
  ON public.system_errors (resolved_at)
  WHERE resolved_at IS NOT NULL;

-- Group/dedup 조회: GROUP BY (tag, error_name, error_message)
-- 메시지가 길어서 hash 로 인덱스. NULL 안전하게 coalesce.
CREATE INDEX IF NOT EXISTS idx_system_errors_fingerprint
  ON public.system_errors (
    md5(
      coalesce(tag, '') || '|' ||
      coalesce(error_name, '') || '|' ||
      coalesce(left(error_message, 500), '')
    )
  );
