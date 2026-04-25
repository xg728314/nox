-- 095_store_settings_missing_columns.sql
-- R29-fix (2026-04-26): /api/store/settings 가 select 하는 컬럼 중 일부가
--   누락된 환경 보정. 사용자 보고:
--     QUERY_FAILED { code: 42703, message: "column store_settings.attendance_period_days does not exist" }
--
-- 누락 가능 컬럼:
--   - migration 018 (staff_grade_criteria): attendance_*/performance_*
--   - migration ~087 (DEPLOY_CHECKLIST 만 언급, 파일 부재): monthly_*/liquor_target_*
--
-- 모두 ADD COLUMN IF NOT EXISTS 라 멱등. 이미 적용된 환경에선 no-op.

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS attendance_period_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS attendance_min_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS performance_unit TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS performance_min_count INTEGER NOT NULL DEFAULT 5;

-- 운영비 (양주 손익분기 계산용 — R20)
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS monthly_rent BIGINT NOT NULL DEFAULT 0;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS monthly_utilities BIGINT NOT NULL DEFAULT 0;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS monthly_misc BIGINT NOT NULL DEFAULT 0;

-- 양주 목표 모드
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS liquor_target_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (liquor_target_mode IN ('auto', 'manual'));
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS liquor_target_amount BIGINT NOT NULL DEFAULT 0;

-- 동일하게 hostesses (migration 018 의 또 다른 ALTER) 도 멱등 보장
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade TEXT CHECK (grade IN ('S','A','B','C'));
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade_updated_at TIMESTAMPTZ;
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade_updated_by UUID REFERENCES profiles(id);

-- 검증 — 모든 컬럼 존재 확인
DO $$
DECLARE
  expected_cols TEXT[] := ARRAY[
    'attendance_period_days', 'attendance_min_days',
    'performance_unit', 'performance_min_count',
    'monthly_rent', 'monthly_utilities', 'monthly_misc',
    'liquor_target_mode', 'liquor_target_amount'
  ];
  c TEXT;
  missing TEXT := '';
BEGIN
  FOREACH c IN ARRAY expected_cols
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='store_settings' AND column_name=c
    ) THEN
      missing := missing || c || ' ';
    END IF;
  END LOOP;
  IF length(missing) > 0 THEN
    RAISE EXCEPTION 'store_settings 컬럼 누락: %', missing;
  END IF;
  RAISE NOTICE '✓ store_settings 모든 컬럼 정상';
END $$;
