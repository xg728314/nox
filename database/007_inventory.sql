CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    unit TEXT NOT NULL DEFAULT 'ea',
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    unit_cost INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_store
    ON inventory_items(store_uuid, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_name
    ON inventory_items(store_uuid, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    before_stock INTEGER NOT NULL DEFAULT 0,
    after_stock INTEGER NOT NULL DEFAULT 0,
    unit_cost INTEGER NOT NULL DEFAULT 0,
    total_cost INTEGER NOT NULL DEFAULT 0,
    memo TEXT,
    actor_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    session_id UUID REFERENCES room_sessions(id),
    business_day_id UUID REFERENCES store_operating_days(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_tx_item
    ON inventory_transactions(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_store
    ON inventory_transactions(store_uuid, created_at DESC);
