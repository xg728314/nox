-- STEP-011B: per-hostess deduction configuration.
--
-- Confirmed rule: "deduction belongs to manager, per-hostess configurable,
-- types: 1타임 / 반타임 / 차3". This table is the override surface. When a
-- matching row exists for (hostess, service_type, time_type), its amount
-- wins; otherwise the settlement calculator falls back to the store-wide
-- default on store_service_types.manager_deduction.
--
-- Additive only. No existing schema modified. RLS stays disabled.

CREATE TABLE IF NOT EXISTS hostess_deduction_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  hostess_id uuid NOT NULL,
  membership_id uuid NULL,
  service_type text NOT NULL,
  time_type text NOT NULL,
  deduction_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hostess_deduction_configs_key
  ON hostess_deduction_configs (store_uuid, hostess_id, service_type, time_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hostess_deduction_configs_store
  ON hostess_deduction_configs (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hostess_deduction_configs_hostess
  ON hostess_deduction_configs (hostess_id)
  WHERE deleted_at IS NULL;
