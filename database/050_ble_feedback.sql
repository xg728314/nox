-- 050_ble_feedback.sql
--
-- Lightweight operator feedback for BLE accuracy gamification.
--
-- Every row is a low-cost tap: 👍 "accurate" / 👎 "wrong". Correction
-- rows auto-emit a negative feedback row via the corrections route
-- (source='correction_auto'). Manual taps use source='manual_tap'.
--
-- Strict invariants:
--   - No business mutation (session / participant / settlement / time
--     / raw BLE) from this table.
--   - Feedback never changes the monitor display — it's accuracy data
--     for analytics + a tiny gamification counter.
--   - Append-only in practice. No deletes from the product surface.

CREATE TABLE IF NOT EXISTS public.ble_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid        uuid NOT NULL REFERENCES public.stores(id),
  membership_id     uuid NOT NULL REFERENCES public.store_memberships(id),
  session_id        uuid REFERENCES public.room_sessions(id),
  participant_id    uuid REFERENCES public.session_participants(id),
  feedback_type     text NOT NULL CHECK (feedback_type IN ('positive', 'negative')),
  zone              text,
  room_uuid         uuid REFERENCES public.rooms(id),
  gateway_id        text,
  source            text NOT NULL DEFAULT 'manual_tap',
  note              text,
  by_membership_id  uuid NOT NULL REFERENCES public.store_memberships(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ble_feedback_store_created
  ON public.ble_feedback (store_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ble_feedback_member
  ON public.ble_feedback (store_uuid, membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ble_feedback_by
  ON public.ble_feedback (store_uuid, by_membership_id, created_at DESC);
