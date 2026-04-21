-- 020: Manager visibility toggles + inventory store_price in write path
-- Applied to live DB

-- Manager visibility: owner sees manager profit ONLY when manager opts in
ALTER TABLE managers ADD COLUMN IF NOT EXISTS show_profit_to_owner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS show_hostess_profit_to_owner BOOLEAN NOT NULL DEFAULT false;
