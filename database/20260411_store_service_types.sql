-- ============================================================
-- store_service_types: 종목별 단가 테이블
-- 매장별 종목(퍼블릭/셔츠/하퍼) × 타임유형(기본/반티/차3) 단가 관리
-- 생성일: 2026-04-11
-- 실행: Supabase Dashboard → SQL Editor 에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS store_service_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    service_type TEXT NOT NULL,           -- 퍼블릭, 셔츠, 하퍼
    time_type TEXT NOT NULL,              -- 기본, 반티, 차3
    time_minutes INTEGER NOT NULL,        -- 90, 60, 45, 30, 15 등
    price INTEGER NOT NULL,               -- 단가 (원)
    manager_deduction INTEGER NOT NULL DEFAULT 0,  -- 실장수익 기본값 (0/5000/10000)
    has_greeting_check BOOLEAN NOT NULL DEFAULT false,  -- 인사확인 옵션 (셔츠만)
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스: store_uuid + service_type 조합 빠른 조회
CREATE INDEX IF NOT EXISTS idx_store_service_types_store_type
    ON store_service_types (store_uuid, service_type, is_active);

-- 유니크 제약: 매장별 동일 종목+타임유형 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_service_types_unique
    ON store_service_types (store_uuid, service_type, time_type)
    WHERE is_active = true;
