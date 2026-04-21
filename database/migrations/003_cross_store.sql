-- ============================================================
-- 003_cross_store.sql
-- Round-073: Cross-store 기반 구축
-- Date: 2026-04-11
--
-- 신규 테이블 3개:
--   1. store_service_types   — 매장별 종목/가격 설정
--   2. cross_store_work_records — 타매장 근무 기록
--   3. inter_store_ledger    — 매장간 정산 원장
--
-- 기존 테이블 수정: 없음
-- ============================================================

-- ============================================================
-- 1. store_service_types (종목 설정)
-- 매장별 서비스 종목과 시간/가격 설정
-- 하드코딩 금지 — 모든 종목은 DB에서 관리
-- ============================================================
CREATE TABLE store_service_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),

    -- 종목 이름 (퍼블릭, 셔츠, 하퍼 등)
    name TEXT NOT NULL,

    -- 풀타임
    fulltime_min INTEGER NOT NULL DEFAULT 60,
    fulltime_price INTEGER NOT NULL DEFAULT 0,

    -- 하프타임
    halftime_min INTEGER NOT NULL DEFAULT 30,
    halftime_price INTEGER NOT NULL DEFAULT 0,

    -- 차3 (시간 범위 기반)
    cha3_min_start INTEGER NOT NULL DEFAULT 0,
    cha3_min_end INTEGER NOT NULL DEFAULT 0,
    cha3_price INTEGER NOT NULL DEFAULT 0,

    -- 경계구간 (풀타임/하프 판정 기준)
    boundary_min INTEGER NOT NULL DEFAULT 5,

    -- 관리
    is_active BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- 같은 매장에서 같은 이름의 활성 종목 중복 방지
    CONSTRAINT uq_store_service_type_active UNIQUE (store_uuid, name, effective_from)
);

-- ============================================================
-- 2. cross_store_work_records (타매장 근무 기록)
-- 아가씨가 원소속이 아닌 다른 매장에서 근무한 기록
-- 정산은 항상 origin_store_uuid 기준
-- ============================================================
CREATE TABLE cross_store_work_records (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

    -- 세션 정보
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),

    -- 매장 정보
    working_store_uuid UUID NOT NULL REFERENCES stores(id),   -- 실제 근무 매장
    origin_store_uuid UUID NOT NULL REFERENCES stores(id),    -- 원소속 매장 (정산 귀속)

    -- 아가씨 정보
    hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id),

    -- 승인
    requested_by UUID NOT NULL REFERENCES profiles(id),
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,

    -- 상태
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    reject_reason TEXT,

    -- 메타
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- 같은 세션에 같은 아가씨 중복 방지
    CONSTRAINT uq_cross_store_work UNIQUE (session_id, hostess_membership_id)
);

-- ============================================================
-- 3. inter_store_ledger (매장간 정산 원장)
-- 타매장 근무에 따른 매장간 줄돈/받을돈 기록
-- ============================================================
CREATE TABLE inter_store_ledger (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

    -- 매장 쌍
    from_store_uuid UUID NOT NULL REFERENCES stores(id),  -- 돈을 주는 매장
    to_store_uuid UUID NOT NULL REFERENCES stores(id),    -- 돈을 받는 매장

    -- 금액
    amount INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL,  -- give | receive

    -- 근거
    source_record_id UUID NOT NULL REFERENCES cross_store_work_records(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),

    -- 상태 흐름: draft → pending → adjusted → closed → paid
    status TEXT NOT NULL DEFAULT 'draft',
    adjusted_amount INTEGER,
    adjusted_reason TEXT,
    adjusted_by UUID REFERENCES profiles(id),
    adjusted_at TIMESTAMPTZ,
    closed_by UUID REFERENCES profiles(id),
    closed_at TIMESTAMPTZ,

    -- 메타
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    -- 같은 근무 기록에 대해 중복 원장 방지
    CONSTRAINT uq_ledger_source UNIQUE (source_record_id, from_store_uuid, to_store_uuid)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_service_types_store ON store_service_types(store_uuid);
CREATE INDEX idx_cross_work_working ON cross_store_work_records(working_store_uuid);
CREATE INDEX idx_cross_work_origin ON cross_store_work_records(origin_store_uuid);
CREATE INDEX idx_cross_work_hostess ON cross_store_work_records(hostess_membership_id);
CREATE INDEX idx_cross_work_session ON cross_store_work_records(session_id);
CREATE INDEX idx_cross_work_bizday ON cross_store_work_records(business_day_id);
CREATE INDEX idx_ledger_from ON inter_store_ledger(from_store_uuid);
CREATE INDEX idx_ledger_to ON inter_store_ledger(to_store_uuid);
CREATE INDEX idx_ledger_bizday ON inter_store_ledger(business_day_id);
