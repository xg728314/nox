-- ============================================================
-- 059_staff_work_logs.sql
-- 아가씨 중심 1차원 운영 로그 (Phase 1 — manual 기록).
--
-- 한 row = "한 아가씨가 특정 시각, 특정 매장/방, 특정 종목/근무형태로
--   들어간 단일 이벤트". append-only + soft-delete + status lifecycle.
-- Phase 1 에서는 manual 기록만 생성한다. BLE / cross_store_settlement
-- 연결 필드는 미리 선언만 해 두고, 후속 라운드에서 채운다.
--
-- 인바리언트:
--   - origin_store_uuid = 아가씨 home store (application-level 검증)
--   - 쓰기 권한 scope: auth.store_uuid === origin_store_uuid (owner/manager)
--   - status='settled' 이후 내용 수정 금지 (application-level 검증)
--
-- DB 스키마 연관 제약:
--   - rooms(id), stores(id), store_memberships(id), profiles(id)
--     FK 모두 기존 테이블. 본 migration 은 기존 테이블 스키마 변경 없음.
--   - cross_store_settlements(id) FK 는 기존 테이블 존재 전제 (이미 있음).
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 1) 아이덴티티 & scope
  origin_store_uuid      UUID NOT NULL REFERENCES stores(id),
  working_store_uuid     UUID NOT NULL REFERENCES stores(id),
  hostess_membership_id  UUID NOT NULL REFERENCES store_memberships(id),
  manager_membership_id  UUID REFERENCES store_memberships(id),

  -- 2) 이벤트 사실
  started_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ,
  working_store_room_label TEXT,
  working_store_room_uuid  UUID REFERENCES rooms(id),
  category               TEXT NOT NULL,
  work_type              TEXT NOT NULL,

  -- 3) 출처 (BLE 연동 대비 — Phase 1 은 manual 만 생성)
  source                 TEXT NOT NULL DEFAULT 'manual',
  source_ref             TEXT,
  ble_event_id           UUID,

  -- 4) 금액 힌트 (참고용)
  external_amount_hint   NUMERIC,

  -- 5) 상태 lifecycle
  status                 TEXT NOT NULL DEFAULT 'draft',

  -- 6) 정산 연결 (Phase 1 에서는 채우지 않음)
  session_id             UUID REFERENCES room_sessions(id),
  session_participant_id UUID REFERENCES session_participants(id),
  cross_store_settlement_id UUID REFERENCES cross_store_settlements(id),

  -- 7) 작성/확정 메타
  memo                   TEXT,
  created_by             UUID REFERENCES profiles(id),
  created_by_role        TEXT,
  confirmed_by           UUID REFERENCES profiles(id),
  confirmed_at           TIMESTAMPTZ,
  voided_by              UUID REFERENCES profiles(id),
  voided_at              TIMESTAMPTZ,
  void_reason            TEXT,

  -- 8) 타임스탬프 / 소프트 삭제
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,

  -- 9) 무결성
  CONSTRAINT swl_time_order
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- ── 인덱스 ─────────────────────────────────────────────────

-- (1) 내 매장 × 아가씨 × 최신순
CREATE INDEX IF NOT EXISTS idx_swl_origin_hostess_started
  ON staff_work_logs (origin_store_uuid, hostess_membership_id, started_at DESC)
  WHERE deleted_at IS NULL;

-- (2) 타매장 관점 (내 매장에서 일한 타매장 아가씨)
CREATE INDEX IF NOT EXISTS idx_swl_working_started
  ON staff_work_logs (working_store_uuid, started_at DESC)
  WHERE deleted_at IS NULL;

-- (3) 상태별 큐
CREATE INDEX IF NOT EXISTS idx_swl_status_created
  ON staff_work_logs (origin_store_uuid, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- (4) 담당 실장별 (매니저 대시보드)
CREATE INDEX IF NOT EXISTS idx_swl_manager
  ON staff_work_logs (manager_membership_id, started_at DESC)
  WHERE deleted_at IS NULL AND manager_membership_id IS NOT NULL;

-- (5) 시간 충돌 탐지용 — 같은 아가씨 활성 로그
CREATE INDEX IF NOT EXISTS idx_swl_hostess_time
  ON staff_work_logs (hostess_membership_id, started_at)
  WHERE deleted_at IS NULL
    AND status IN ('draft', 'confirmed', 'settled');

-- (6) BLE source 중복 차단 — source_ref 유일 (Phase 1 은 unused, 사전 선언)
CREATE UNIQUE INDEX IF NOT EXISTS uq_swl_source_ref
  ON staff_work_logs (source, source_ref)
  WHERE source_ref IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE staff_work_logs IS
  'Staff (hostess) 중심 1차원 운영 로그. Phase 1 = 수동 기록. Phase 2 에서 BLE source 및 정산 편입 예정.';
