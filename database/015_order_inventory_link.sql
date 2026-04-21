-- 015: Link orders to inventory_items for stock decrement on order
-- Adds optional inventory_item_id FK to orders table

ALTER TABLE orders
  ADD COLUMN inventory_item_id UUID REFERENCES inventory_items(id);

-- Index for reverse lookups (inventory item → orders)
CREATE INDEX IF NOT EXISTS idx_orders_inventory_item_id
  ON orders (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN orders.inventory_item_id IS 'Optional FK to inventory_items. Set for 주류 orders to enable stock decrement.';
