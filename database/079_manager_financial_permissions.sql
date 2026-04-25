-- ============================================================
-- 079_manager_financial_permissions.sql
--
-- 목적:
--   실장(manager) 에게 cross-store payout 실행 권한을 owner 가 명시적으로
--   위임/회수할 수 있는 기반 테이블을 생성한다.
--
-- 원칙 (설계 라운드 재확인):
--   - handler / executor / permission 세 축은 절대 혼합하지 않는다.
--       handler   = cross_store_settlement_items.current_handler_membership_id
--                   (item 단위 처리 배정)
--       executor  = payout_records.executor_membership_id
--                   (실제 실행자 기록)
--       permission = manager_financial_permissions (본 테이블)
--                   (owner 가 manager 에게 재정 실행 권한을 명시 위임)
--   - ownerFinancialGuard 는 manager 경로에서
--       (1) permission 존재 AND revoked_at IS NULL AND can_cross_store_payout=true
--       (2) item.current_handler_membership_id = auth.membership_id
--     **둘 다** 충족 시에만 통과.
--   - payout 계산 / RPC / aggregate 로직은 본 라운드에서 일체 변경하지 않는다.
--
-- 범위:
--   - grant/revoke API 는 본 라운드에서 만들지 않는다. 초기 데이터는
--     service-role SQL 로만 삽입 (운영 수동 투입).
--   - RLS 정책은 본 라운드에서 추가하지 않는다 (service-role 접근만 가정).
--
-- 멱등: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + DO $$ 가드.
-- ============================================================

-- ── [1] 테이블 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_financial_permissions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- scope: 어느 매장에서 어떤 실장에게 위임되는가
  store_uuid                UUID NOT NULL REFERENCES stores(id),
  membership_id             UUID NOT NULL REFERENCES store_memberships(id),

  -- 권한 플래그 (현재 1종만 정의, 향후 확장 대비 BOOLEAN 컬럼으로 개별화)
  -- 본 라운드에서는 can_cross_store_payout 만 정의. cancel 은 동일 flag 로 판정.
  -- (payout 과 cancel 을 분리하려면 후속 migration 에서 별도 컬럼 추가)
  can_cross_store_payout    BOOLEAN NOT NULL DEFAULT false,

  -- grant audit
  granted_by_user_id        UUID NOT NULL REFERENCES auth.users(id),
  granted_by_membership_id  UUID NOT NULL REFERENCES store_memberships(id),
  granted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grant_reason              TEXT,

  -- revoke audit (revoked_at IS NULL 이면 active)
  revoked_by_user_id        UUID REFERENCES auth.users(id),
  revoked_by_membership_id  UUID REFERENCES store_memberships(id),
  revoked_at                TIMESTAMPTZ,
  revoke_reason             TEXT,

  -- soft delete 통일 (NOX 관례)
  deleted_at                TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE manager_financial_permissions IS
  'Phase 10 (2026-04-24): owner → manager 재정 실행 권한 위임 레지스트리. ownerFinancialGuard 의 manager 경로 통과 조건 중 하나 (handler 검사와 AND 결합).';
COMMENT ON COLUMN manager_financial_permissions.can_cross_store_payout IS
  'cross-store payout 실행 가능 여부. cancel 도 동일 flag 로 판정. false 이면 레코드는 존재하지만 비활성.';
COMMENT ON COLUMN manager_financial_permissions.revoked_at IS
  'NULL = active. NOT NULL = 회수됨. guard 는 revoked_at IS NULL 조건 필수.';

-- ── [2] 정합성 체크 ──────────────────────────────────────────
-- revoke 필드는 세트로 채워져야 함 (부분 상태 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfp_revoke_triplet_consistent'
  ) THEN
    ALTER TABLE manager_financial_permissions
      ADD CONSTRAINT mfp_revoke_triplet_consistent
      CHECK (
        (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoked_by_membership_id IS NULL)
        OR
        (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND revoked_by_membership_id IS NOT NULL)
      );
  END IF;
END $$;

-- ── [3] 인덱스 ───────────────────────────────────────────────
-- (3-1) active permission 유일성: (store_uuid, membership_id) 조합에
--       동시 active 가 둘 이상 존재하지 못하도록 강제.
--       revoke 된 레코드는 과거 이력으로 보존 → partial unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfp_active
  ON manager_financial_permissions (store_uuid, membership_id)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;

-- (3-2) guard 조회용 lookup: (membership_id, store_uuid) 순서
--       guard 는 auth.membership_id + auth.store_uuid 로 조회.
CREATE INDEX IF NOT EXISTS idx_mfp_lookup
  ON manager_financial_permissions (membership_id, store_uuid)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;

-- (3-3) audit / 운영 조회용: store 별 active 리스트
CREATE INDEX IF NOT EXISTS idx_mfp_store_active
  ON manager_financial_permissions (store_uuid, granted_at DESC)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;

-- ── [4] updated_at 트리거 (NOX 관례가 있으면 동일 패턴) ──────
-- 본 라운드에서는 updated_at 을 애플리케이션이 갱신하지 않는다.
-- revoke API 가 추가되는 후속 라운드에서 명시적으로 UPDATE 하도록 한다.
-- (NOX 에 전역 trigger 가 없고 라운드 범위 최소화 원칙 유지)

-- ============================================================
-- 본 migration 은 순수 구조 추가만 수행한다.
-- record/ route / guard 변경은 080 이후 라운드에서 분리 진행.
-- ============================================================
