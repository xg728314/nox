-- 017: Customer enhancements
-- Adds manager ownership, tags, and ensures session linkage

-- 1. Manager ownership for customer visibility scope
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS manager_membership_id UUID REFERENCES store_memberships(id);

-- 2. Tags (JSONB array: ["단골", "큰손", "퍼블릭선호", "주의"])
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Index for manager-scoped queries
CREATE INDEX IF NOT EXISTS idx_customers_manager
  ON customers (store_uuid, manager_membership_id)
  WHERE manager_membership_id IS NOT NULL;

-- 4. Index for tag queries
CREATE INDEX IF NOT EXISTS idx_customers_tags
  ON customers USING gin (tags);
