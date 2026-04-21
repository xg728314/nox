-- 049_ble_presence_corrections.sql
--
-- Human correction overlay for BLE presence.
--
-- Strict invariants:
--   - raw BLE tables (ble_ingest_events, ble_tag_presence, ble_tags,
--     ble_gateways) are NEVER written by the correction flow
--   - corrections never drive business state — they are display-layer
--     overlays scoped to monitor rendering
--   - every write is auditable via this table (append-only in practice;
--     is_active flip reserved for a future revert UI)
--
-- Monitor read model consults this table per request and applies the
-- latest active correction per membership to the BLE overlay emitted
-- to the UI. Correction history accumulates for future analysis.

CREATE TABLE IF NOT EXISTS public.ble_presence_corrections (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid                 uuid NOT NULL REFERENCES public.stores(id),
  membership_id              uuid NOT NULL REFERENCES public.store_memberships(id),
  session_id                 uuid REFERENCES public.room_sessions(id),
  participant_id             uuid REFERENCES public.session_participants(id),
  original_zone              text NOT NULL,
  corrected_zone             text NOT NULL,
  original_room_uuid         uuid REFERENCES public.rooms(id),
  corrected_room_uuid        uuid REFERENCES public.rooms(id),
  ble_presence_seen_at       timestamptz,
  corrected_by_membership_id uuid NOT NULL REFERENCES public.store_memberships(id),
  corrected_at               timestamptz NOT NULL DEFAULT now(),
  gateway_id                 text,
  reason                     text,
  note                       text,
  is_active                  boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_ble_corrections_member
  ON public.ble_presence_corrections (store_uuid, membership_id, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ble_corrections_participant
  ON public.ble_presence_corrections (store_uuid, participant_id, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ble_corrections_active
  ON public.ble_presence_corrections (store_uuid, is_active, corrected_at DESC);
