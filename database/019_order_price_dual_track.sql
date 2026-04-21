-- 019: Order price dual track — store_price / sale_price separation
-- Applied in 2 phases: previous session added store_price/sale_price/manager_amount/customer_amount to orders.
-- This migration records the inventory extension.

-- Phase 1 (already applied to live DB):
-- ALTER TABLE orders ADD COLUMN store_price INTEGER;
-- ALTER TABLE orders ADD COLUMN sale_price INTEGER;
-- ALTER TABLE orders ADD COLUMN manager_amount INTEGER;
-- ALTER TABLE orders ADD COLUMN customer_amount INTEGER;
-- UPDATE orders SET store_price=unit_price, sale_price=unit_price, manager_amount=0, customer_amount=unit_price*qty WHERE store_price IS NULL;
-- ALTER TABLE orders ALTER COLUMN store_price SET NOT NULL; (+ DEFAULT 0, CHECK >= 0)
-- ALTER TABLE orders ALTER COLUMN sale_price SET NOT NULL;
-- ALTER TABLE orders ALTER COLUMN manager_amount SET NOT NULL;
-- ALTER TABLE orders ALTER COLUMN customer_amount SET NOT NULL;

-- Phase 2: Inventory product master extension
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS store_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_per_box INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS units_per_box INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_per_unit INTEGER NOT NULL DEFAULT 0;

-- Backfill: store_price = unit_cost for existing items
UPDATE inventory_items SET store_price = unit_cost WHERE store_price = 0 AND unit_cost > 0;
