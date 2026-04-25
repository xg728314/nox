-- ============================================================
-- 077_settlement_handover_foundation.sql
--
-- 목적:
--   같은 매장 내 실장 정산 인계 기능의 최소 DB 기반을 추가한다.
--   owner / handler / executor 세 축을 절대 혼합하지 않기 위해
--   handler 는 별도 컬럼, executor 도 별도 컬럼으로 분리한다.
--
-- 원칙 (설계 라운드에서 확정):
--   owner    = cross_store_settlement_items.manager_membership_id
--              = target_manager_membership_id
--            → 본 migration 에서 **절대 건드리지 않음**. 인계는 owner 교체가 아니다.
--   handler  = cross_store_settlement_items.current_handler_membership_id (신규)
--            → NULL = owner 본인 처리. NOT NULL = 다른 실장에게 처리 위임.
--   executor = payout_records.executor_membership_id (신규)
--            = manager_prepayments.executor_membership_id (신규)
--            → 실제 지급/선지급 실행 시점의 실장 membership 기록.
--              NOX 선례: pre_settlements 의 executor_membership_id 패턴과 동일.
--
-- 영향 범위:
--   - 신규 컬럼 전부 nullable. 기존 row backfill 불필요. 읽기 쿼리 무변경.
--   - 기존 RPC (record_cross_store_payout / cancel_settlement_payout) 미수정.
--     executor 채움은 route 층에서 RPC 호출 후 UPDATE payout_records 로 수행.
--   - aggregate / assign-manager / payment_method / 선지급 (manager_prepayments)
--     computation 로직 무변경.
--
-- 멱등: IF NOT EXISTS 전부 적용. 재실행 안전.
-- ============================================================

-- ── [1] cross_store_settlement_items: handler 축 3개 ──────────
ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS current_handler_membership_id UUID,
  ADD COLUMN IF NOT EXISTS handover_at                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handover_reason               TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cssi_current_handler_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_current_handler_fk
      FOREIGN KEY (current_handler_membership_id)
      REFERENCES store_memberships(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cssi_current_handler
  ON cross_store_settlement_items (current_handler_membership_id)
  WHERE current_handler_membership_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN cross_store_settlement_items.current_handler_membership_id IS
  'Phase 10 (2026-04-24): 현재 처리 실장 (handler). NULL = owner 본인 처리. owner=manager_membership_id 와 동일 의미 아님 — 인계 전용 축.';
COMMENT ON COLUMN cross_store_settlement_items.handover_at IS
  'Phase 10 (2026-04-24): 인계 시각. release 시 NULL 로 되돌림.';
COMMENT ON COLUMN cross_store_settlement_items.handover_reason IS
  'Phase 10 (2026-04-24): 인계 사유. audit_events 로도 기록되나 빠른 조회 용으로 row 에도 저장.';

-- ── [2] payout_records: executor 축 1개 ──────────────────────
ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS executor_membership_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_records_executor_fk'
  ) THEN
    ALTER TABLE payout_records
      ADD CONSTRAINT payout_records_executor_fk
      FOREIGN KEY (executor_membership_id)
      REFERENCES store_memberships(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_records_executor
  ON payout_records (executor_membership_id)
  WHERE executor_membership_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN payout_records.executor_membership_id IS
  'Phase 10 (2026-04-24): 실제 지급 실행자 membership. created_by (user_id) 와 별개. target_manager_membership_id (owner) 와 다를 수 있음 (인계 상황).';

-- ── [3] manager_prepayments: executor 축 1개 ─────────────────
ALTER TABLE manager_prepayments
  ADD COLUMN IF NOT EXISTS executor_membership_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manager_prepayments_executor_fk'
  ) THEN
    ALTER TABLE manager_prepayments
      ADD CONSTRAINT manager_prepayments_executor_fk
      FOREIGN KEY (executor_membership_id)
      REFERENCES store_memberships(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_manager_prepayments_executor
  ON manager_prepayments (executor_membership_id)
  WHERE executor_membership_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN manager_prepayments.executor_membership_id IS
  'Phase 10 (2026-04-24): 선지급 실행자 membership. target_manager_membership_id (owner) 와 다를 수 있음.';

-- ── [참고] Owner vs Handler 불변식은 API 층에서 강제.
--   DB CHECK 로 걸면 backfill / concurrent update 에서 이상 row 가 있을
--   가능성 — NOT VALID 로도 가능하나 본 라운드는 API 가드 신뢰.
-- ============================================================
