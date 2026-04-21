-- 023: Inventory item uniqueness — allow same name with different units
-- Previous: UNIQUE(store_uuid, name) WHERE deleted_at IS NULL   (007_inventory.sql)
-- New:      UNIQUE(store_uuid, name, unit) WHERE deleted_at IS NULL
--
-- Rationale:
--   Operators register the same product in multiple stock units
--   (e.g. "골든블루" in 박스 and "골든블루" in 병 for partial-bottle sales).
--   The old name-only index blocked this legitimate operational case while
--   still allowing soft-deleted ghosts to collide.
--
-- Impact:
--   - Existing unique rows are unaffected.
--   - Same (store, name) pairs that ONLY differ by unit become allowed.
--   - Same (store, name, unit) triple remains blocked with SQLSTATE 23505.

DROP INDEX IF EXISTS idx_inventory_items_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_name_unit
    ON inventory_items(store_uuid, name, unit) WHERE deleted_at IS NULL;
