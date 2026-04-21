-- 041: Atomic stock increment function for order deletion restore
-- Mirrors the decrement_stock pattern from 022_atomic_stock_decrement.sql
-- Uses SELECT ... FOR UPDATE to lock the row during the transaction

CREATE OR REPLACE FUNCTION increment_stock(
  p_item_id UUID,
  p_store_uuid UUID,
  p_qty INTEGER
) RETURNS TABLE(
  success BOOLEAN,
  before_stock INTEGER,
  after_stock INTEGER
) LANGUAGE plpgsql AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  -- Lock the row with FOR UPDATE to prevent concurrent reads
  SELECT i.current_stock
  INTO v_current_stock
  FROM inventory_items i
  WHERE i.id = p_item_id
    AND i.store_uuid = p_store_uuid
    AND i.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    success := false;
    before_stock := 0;
    after_stock := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Atomic increment
  UPDATE inventory_items
  SET current_stock = current_stock + p_qty, updated_at = now()
  WHERE id = p_item_id AND store_uuid = p_store_uuid;

  success := true;
  before_stock := v_current_stock;
  after_stock := v_current_stock + p_qty;
  RETURN NEXT;
  RETURN;
END;
$$;
