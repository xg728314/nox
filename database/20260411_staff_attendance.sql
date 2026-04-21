-- ============================================================
-- staff_attendance: 출퇴근 기록 테이블
-- 영업일별 스태프(실장/아가씨) 출근/퇴근/상태 관리
-- 생성일: 2026-04-11
-- 실행: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    role TEXT NOT NULL,                                -- manager, hostess
    status TEXT NOT NULL DEFAULT 'available',          -- available, assigned, in_room, off_duty
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_out_at TIMESTAMPTZ,
    assigned_room_uuid UUID REFERENCES rooms(id),     -- 현재 배정된 방 (assigned/in_room)
    assigned_by UUID REFERENCES profiles(id),         -- 배정한 사람
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스: 영업일별 매장 출근 현황 빠른 조회
CREATE INDEX IF NOT EXISTS idx_staff_attendance_store_day
    ON staff_attendance (store_uuid, business_day_id, status);

-- 유니크: 같은 영업일에 같은 스태프 중복 출근 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_attendance_unique
    ON staff_attendance (store_uuid, business_day_id, membership_id)
    WHERE status != 'off_duty';
