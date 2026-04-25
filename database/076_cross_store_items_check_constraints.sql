-- ============================================================
-- 076_cross_store_items_check_constraints.sql
--
-- 목적:
--   cross_store_settlement_items 금액/상태 컬럼에 최소한의 CHECK 제약을
--   **NOT VALID** 로 추가. 기존 레거시 row 를 재검증하지 않고 신규
--   insert/update 에만 효력.
--
--   RPC (record_cross_store_payout) 는 이미 OVERPAY / HEADER_REMAINING_NEGATIVE
--   등을 검증하지만, 직접 INSERT/UPDATE 경로 (신규 aggregate route 포함)
--   가 우회하는 것을 DB 레벨에서 방어.
--
-- 원칙:
--   - NOT VALID: 기존 row 검증 skip → 배포 시 테이블 lock 최소.
--   - NULL 허용: amount/paid_amount/remaining_amount 모두 nullable 기원
--     (migration 036 이 amount 를 nullable 로 추가). NULL 은 통과.
--   - status 화이트리스트: 레거시 값 혼재 가능성 고려해 상식적 범위 허용.
--   - `paid + remaining = amount` 불변식은 CHECK 로 걸지 않는다 (legacy
--     backfill 로 일시 불일치 가능). RPC 와 route 가 런타임 보증.
--
-- 향후 라운드에서 VALIDATE 실행:
--   ALTER TABLE cross_store_settlement_items VALIDATE CONSTRAINT <name>;
--   기존 row 가 전부 충족하는 것을 확인한 뒤에만.
--
-- 멱등: DO 블록으로 중복 생성 차단.
-- ============================================================

DO $$
BEGIN
  -- amount >= 0
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_amount_non_negative'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_amount_non_negative
      CHECK (amount IS NULL OR amount >= 0) NOT VALID;
  END IF;

  -- paid_amount >= 0
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_paid_amount_non_negative'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_paid_amount_non_negative
      CHECK (paid_amount IS NULL OR paid_amount >= 0) NOT VALID;
  END IF;

  -- remaining_amount >= 0
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_remaining_amount_non_negative'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_remaining_amount_non_negative
      CHECK (remaining_amount IS NULL OR remaining_amount >= 0) NOT VALID;
  END IF;

  -- status 화이트리스트 (레거시 + 신규 전이 상태 모두 포용)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_status_check'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_status_check
      CHECK (
        status IS NULL OR status IN (
          'open', 'pending', 'partial', 'completed', 'cancelled', 'closed'
        )
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT cssi_amount_non_negative ON cross_store_settlement_items IS
  'Phase 9 (2026-04-24): amount 음수 방지. NOT VALID — 기존 row 재검증 안 함.';
COMMENT ON CONSTRAINT cssi_paid_amount_non_negative ON cross_store_settlement_items IS
  'Phase 9 (2026-04-24): paid_amount 음수 방지. NOT VALID.';
COMMENT ON CONSTRAINT cssi_remaining_amount_non_negative ON cross_store_settlement_items IS
  'Phase 9 (2026-04-24): remaining_amount 음수 방지. NOT VALID. RPC overpay 가드 + DB 가드 이중 방어.';
COMMENT ON CONSTRAINT cssi_status_check ON cross_store_settlement_items IS
  'Phase 9 (2026-04-24): status 허용 집합. NOT VALID — 레거시 임의 값 잔존 대비.';
