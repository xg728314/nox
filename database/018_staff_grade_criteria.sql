-- 018: Staff grade (manual) + attendance/performance criteria in store_settings
-- STAFF-1 + STAFF-2

-- 1) Add manual grade columns to hostesses table
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade TEXT CHECK (grade IN ('S','A','B','C'));
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade_updated_at TIMESTAMPTZ;
ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS grade_updated_by UUID REFERENCES profiles(id);

-- 2) Add staff management criteria to store_settings
-- attendance_period_days: 7 / 14 / 30
-- attendance_min_days: minimum attendance days in that period
-- performance_unit: 'daily' / 'weekly' / 'monthly'
-- performance_min_count: minimum session count per unit
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS attendance_period_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS attendance_min_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS performance_unit TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS performance_min_count INTEGER NOT NULL DEFAULT 5;
