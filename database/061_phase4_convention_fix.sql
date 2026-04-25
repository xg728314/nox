-- ⚠️ STATUS: INCOMPATIBLE / SKIP (2026-04-24 Round 3 실사)
-- 본 migration 은 apply 불가. 사유:
--   1. items.staff_work_log_id 컬럼이 없음 (060 미적용)
--   2. header.store_uuid / target_store_uuid / note 는 038 에서 DROP 됨
-- 따라서 WHERE / UPDATE SET 절 모두 "column does not exist" 에러.
-- 또한 방향 규약(from=payer, to=receiver)은 이미 코드 레벨에서 일관 준수 중 →
-- backfill 불필요. 참조용으로만 보존. apply 금지.
--
-- ============================================================
-- 061_phase4_convention_fix.sql
--
-- ROUND-C: cross_store from/to 방향 단일 규약 통일 backfill.
--
-- 규약 (canonical, migration 036 / legacy RPC 와 일치):
--   from_store_uuid = 돈을 **지불** 하는 매장 (payer)
--   to_store_uuid   = 돈을 **수취** 하는 매장 (receiver)
--
-- Phase 4 aggregate 는 스펙 literal 해석 오류로 **반대 방향**
-- (from=origin=caller, to=working) 으로 저장되어 왔다. 이 backfill 은
-- **Phase 4 origin rows 만** 선별해 from/to 를 교환한다.
--
-- 식별자:
--   Phase 4 aggregate 는 items.staff_work_log_id 를 NOT NULL 로 채움.
--   이 컬럼으로 Phase 4 rows 식별.
--
-- 안전성:
--   - 기존 legacy rows (manager 집계, 수동 cross_store) 는
--     staff_work_log_id IS NULL 이므로 영향 없음.
--   - 스키마 변경 없음. 데이터 교환만.
--   - 교환 후 UNIQUE / FK 제약 위반 없음
--     (from_store_uuid/to_store_uuid 에 UNIQUE 없음).
-- ============================================================

-- 1) Phase 4 헤더 id 집합
WITH phase4_header_ids AS (
  SELECT DISTINCT cross_store_settlement_id AS id
  FROM cross_store_settlement_items
  WHERE staff_work_log_id IS NOT NULL
    AND deleted_at IS NULL
)

-- 2) 헤더의 from/to + store_uuid/target_store_uuid (legacy mirror) 교환
UPDATE cross_store_settlements h
SET
  from_store_uuid    = h.to_store_uuid,
  to_store_uuid      = h.from_store_uuid,
  store_uuid         = h.target_store_uuid,
  target_store_uuid  = h.store_uuid,
  updated_at         = now(),
  note = COALESCE(h.note, '') || ' [round-c-swap]',
  memo = COALESCE(h.memo, '') || ' [round-c-swap]'
FROM phase4_header_ids p
WHERE h.id = p.id;

-- 3) 같은 헤더에 연결된 items 의 store_uuid/target_store_uuid 도 교환
--    manager_membership_id / target_manager_membership_id 는 항상
--    **origin(receiver) 측 manager** 를 가리키므로 교환하지 않는다
--    (Phase 4 insert 시에도 log.manager_membership_id 를 그대로 넣음).
UPDATE cross_store_settlement_items i
SET
  store_uuid        = i.target_store_uuid,
  target_store_uuid = i.store_uuid,
  updated_at        = now()
WHERE i.staff_work_log_id IS NOT NULL
  AND i.deleted_at IS NULL;

-- 주의: settlements_items.manager_membership_id 및 target_manager_membership_id
-- 는 의미적으로 모두 "origin(receiver) 매장 manager" 이므로 교환 대상 아님.
-- legacy rows (staff_work_log_id IS NULL) 는 건드리지 않는다.
