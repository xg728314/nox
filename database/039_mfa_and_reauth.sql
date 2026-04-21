-- STEP-013D: MFA, trusted devices, reauth.
--
-- Additive schema only — no existing tables touched. RLS remains off
-- for MVP consistency with the rest of the project; all access goes
-- through resolveAuthContext + service-role in API routes.
--
-- Design notes:
--   * user_mfa_settings stores AES-256-GCM-encrypted TOTP secrets.
--     Columns split iv / ciphertext / auth_tag so we never need to
--     base64 a composite blob. `is_enabled` only flips to true after
--     the client successfully verifies a code during /mfa/enable.
--   * trusted_devices.device_hash = HMAC-SHA256(server_key || user_id
--     || client_device_id). The server never stores the raw client
--     device id, and two different users submitting the same client
--     id produce different hashes.
--   * reauth_verifications is the short-lived attestation that the
--     actor has re-authenticated for a sensitive action. The three
--     financial write routes check for a non-expired row keyed to
--     (user_id, action_class='financial_write').
--
-- All tables are soft-delete capable where it makes sense; device
-- revocation uses revoked_at instead of a hard delete so historical
-- audit trails remain intact.

CREATE TABLE IF NOT EXISTS user_mfa_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT false,
  -- AES-256-GCM envelope, base64-encoded text for easy REST I/O.
  secret_iv text,
  secret_ciphertext text,
  secret_auth_tag text,
  backup_codes_hashed text[],
  enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_settings_user ON user_mfa_settings(user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- HMAC-SHA256 of (server_key || user_id || client_device_id)
  device_hash text NOT NULL,
  device_name text,
  user_agent_summary text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  trusted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_devices_user_hash
  ON trusted_devices(user_id, device_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS reauth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action_class text NOT NULL,  -- 'financial_write' | 'account_change' | ...
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reauth_verifications_user_action_expires
  ON reauth_verifications(user_id, action_class, expires_at DESC);
