-- 022: Atomic stock decrement function
-- Prevents race condition where concurrent orders both pass stock check
-- Uses SELECT ... FOR UPDATE to lock the row during the transaction

CREATE OR REPLACE FUNCTION decrement_stock(
  p_item_id UUID,
  p_store_uuid UUID,
  p_qty INTEGER
) RETURNS TABLE(
  success BOOLEAN,
  before_stock INTEGER,
  after_stock INTEGER,
  item_name TEXT,
  item_store_price INTEGER,
  item_unit_cost INTEGER
) LANGUAGE plpgsql AS $$
DECLARE
  v_current_stock INTEGER;
  v_name TEXT;
  v_store_price INTEGER;
  v_unit_cost INTEGER;
BEGIN
  -- Lock the row with FOR UPDATE to prevent concurrent reads
  SELECT i.current_stock, i.name, i.store_price, i.unit_cost
  INTO v_current_stock, v_name, v_store_price, v_unit_cost
  FROM inventory_items i
  WHERE i.id = p_item_id AND i.store_uuid = p_store_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- empty result = item not found
  END IF;

  IF v_current_stock < p_qty THEN
    -- Insufficient stock: return current state without decrementing
    success := false;
    before_stock := v_current_stock;
    after_stock := v_current_stock;
    item_name := v_name;
    item_store_price := v_store_price;
    item_unit_cost := v_unit_cost;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Atomic decrement
  UPDATE inventory_items
  SET current_stock = current_stock - p_qty, updated_at = now()
  WHERE id = p_item_id AND store_uuid = p_store_uuid;

  success := true;
  before_stock := v_current_stock;
  after_stock := v_current_stock - p_qty;
  item_name := v_name;
  item_store_price := v_store_price;
  item_unit_cost := v_unit_cost;
  RETURN NEXT;
  RETURN;
END;
$$;
