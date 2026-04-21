-- STEP-010: 내 정보 (My Info) — settlement accounts & payee accounts
--
-- settlement_accounts — personal bank accounts owned by a store_membership.
--   Multiple rows per owner allowed. At most one is_default per owner
--   enforced by a partial unique index. Used as the destination for the
--   membership's share of settlement payouts.
--
-- payee_accounts — external or cross-party payee accounts (e.g. managers
--   paying out to external parties). linked_membership_id is nullable
--   because a payee may not have a membership in this store.
--
-- Both tables are store-scoped. RLS stays disabled for MVP; route-level
-- store_uuid scoping + owner_membership_id checks enforce access control.
-- Soft-delete via deleted_at (consistent with the rest of the schema).

CREATE TABLE IF NOT EXISTS settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  owner_membership_id uuid NOT NULL,

  bank_name text,
  account_holder_name text,
  account_number text,

  account_type text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  note text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_settlement_accounts_owner
  ON settlement_accounts (store_uuid, owner_membership_id)
  WHERE deleted_at IS NULL;

-- Only one default per (store_uuid, owner_membership_id) among live rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_accounts_default
  ON settlement_accounts (store_uuid, owner_membership_id)
  WHERE is_default = true AND deleted_at IS NULL;


CREATE TABLE IF NOT EXISTS payee_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,

  linked_membership_id uuid,

  payee_name text,
  role_type text,

  bank_name text,
  account_holder_name text,
  account_number text,

  is_active boolean DEFAULT true,
  note text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payee_accounts_store
  ON payee_accounts (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payee_accounts_linked
  ON payee_accounts (store_uuid, linked_membership_id)
  WHERE deleted_at IS NULL AND linked_membership_id IS NOT NULL;
