-- 108_paper_ledger_retention.sql
-- R-Paper-Retention (2026-05-01): 매장별 종이장부 사진 자동 만료 정책.
--
-- 운영자 의도:
--   "장부 사진은 손님/스태프 PII 가 찍혀있어 예민. 일정 기간 후 자동
--    삭제하되 매장이 직접 보관 기간 정한다.
--    학습 corpus (learning_signals) 는 hash 처리되어 있으니 보존."
--
-- 정책 (DELETE cascade):
--   사진 (Storage) + paper_ledger_snapshots / extractions / edits / diffs
--     → 삭제
--   learning_signals (PII auto-hash) + store_paper_format
--     → 보존 (학습 효과 유지)
--
-- 설정:
--   - paper_ledger_retention_days = 30 (default)
--   - 0 또는 NULL = 자동 만료 안 함 (수동 삭제만)
--   - cron 매일 0시 KST 실행 → expires_at 경과 row 일괄 삭제
--
-- 추가 컬럼:
--   - store_settings.paper_ledger_retention_days int (default 30)
--   - paper_ledger_snapshots.expires_at timestamptz (uploaded_at + retention_days)
--     trigger 또는 application 측에서 set.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS paper_ledger_retention_days INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN store_settings.paper_ledger_retention_days IS
  'R-Paper-Retention: 종이장부 사진 자동 만료 일수. 0 = 자동 만료 없음 (수동 삭제만). default 30일.';

ALTER TABLE paper_ledger_snapshots
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_paper_ledger_snapshots_expires_at
  ON paper_ledger_snapshots (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN paper_ledger_snapshots.expires_at IS
  'R-Paper-Retention: 자동 삭제 예정 시각. uploaded_at + store_settings.paper_ledger_retention_days. cron 이 매일 만료된 row 일괄 cascade 삭제.';

-- 기존 row 에 expires_at 채우기 (마이그레이션 시점 기준 + 30일).
-- 이미 archived_at 인 row 는 건드리지 않음.
UPDATE paper_ledger_snapshots
SET expires_at = uploaded_at + INTERVAL '30 days'
WHERE expires_at IS NULL
  AND archived_at IS NULL;
