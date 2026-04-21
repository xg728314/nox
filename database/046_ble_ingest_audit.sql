-- 046_ble_ingest_audit.sql — BLE P0 security hardening.
--
-- `audit_events` has actor_profile_id UUID NOT NULL REFERENCES profiles(id),
-- so gateway-driven audit inserts were silently discarded (FK failure).
-- This dedicated table avoids the FK mismatch and captures every BLE
-- ingest attempt — including rejected auth/HMAC/schema attempts — for
-- forensic reconstruction.

CREATE TABLE IF NOT EXISTS public.ble_ingest_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- store_uuid is nullable so that failed auth attempts (where we never
  -- resolved the gateway) are still audited under gateway_id only.
  store_uuid     uuid REFERENCES public.stores(id),
  gateway_id     text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  event_count    integer NOT NULL DEFAULT 0,
  success        boolean NOT NULL DEFAULT false,
  error_message  text,
  raw_hash       text
);

CREATE INDEX IF NOT EXISTS idx_ble_ingest_audit_gw
  ON public.ble_ingest_audit (gateway_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_ble_ingest_audit_store
  ON public.ble_ingest_audit (store_uuid, received_at DESC)
  WHERE store_uuid IS NOT NULL;

-- Dedupe support: the ingest route checks existing rows by this 4-tuple
-- over the last 5 minutes. A covering index accelerates that lookup and
-- bounds the query cost per request.
CREATE INDEX IF NOT EXISTS idx_ble_ingest_events_dedupe
  ON public.ble_ingest_events (gateway_id, observed_at, beacon_minor, event_type);
