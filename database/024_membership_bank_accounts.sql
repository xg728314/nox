-- 024: membership_bank_accounts — 개인 계좌 관리 (내정보)
--
-- Each store_membership can register one or more bank accounts.
-- Scoped to membership_id (self-only); store_uuid is kept for store-wide queries.
-- Receipt integration in a later round will let operators select one of these
-- accounts to show on the customer-facing bill footer.

CREATE TABLE IF NOT EXISTS membership_bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_uuid UUID NOT NULL REFERENCES stores(id),
  membership_id UUID NOT NULL REFERENCES store_memberships(id),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Hot path: "list my accounts"
CREATE INDEX IF NOT EXISTS idx_membership_bank_accounts_membership
  ON membership_bank_accounts (membership_id, is_active)
  WHERE deleted_at IS NULL;

-- Store-scoped read (future: owner dashboard)
CREATE INDEX IF NOT EXISTS idx_membership_bank_accounts_store
  ON membership_bank_accounts (store_uuid)
  WHERE deleted_at IS NULL;

-- At most one default per membership (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_bank_accounts_default
  ON membership_bank_accounts (membership_id)
  WHERE is_default = true AND deleted_at IS NULL;
