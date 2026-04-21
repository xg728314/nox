-- 047_session_participant_actions.sql
--
-- Operator action layer for /counter/monitor.
--
-- This table is the source of truth for explicit human operator
-- decisions taken from the monitoring surface:
--
--   still_working : mute repeat absence alerts; no session/participant
--                   state change.
--   end_now       : mark participant as ended at acted_at; no backdate.
--                   Hides the participant from monitor next poll.
--   extend        : increment extension_count; keep participant active.
--
-- STRICT: this table NEVER drives settlement, session, or participant
-- mutations. It is operator history only. The /counter transactional
-- workflow remains the authoritative path for those state changes.
--
-- BLE is never allowed to write to this table — every row must be
-- attributed to a real store_memberships record (acted_by_membership_id).

CREATE TABLE IF NOT EXISTS public.session_participant_actions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid              uuid NOT NULL REFERENCES public.stores(id),
  session_id              uuid NOT NULL REFERENCES public.room_sessions(id),
  participant_id          uuid NOT NULL REFERENCES public.session_participants(id),
  action_type             text NOT NULL CHECK (action_type IN ('still_working', 'end_now', 'extend')),
  acted_by_membership_id  uuid REFERENCES public.store_memberships(id),
  acted_at                timestamptz NOT NULL DEFAULT now(),
  effective_at            timestamptz NOT NULL DEFAULT now(),
  note                    text,
  extension_count         integer,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Derived-state queries from /api/counter/monitor use (store_uuid,
-- participant_id) scan ordered by acted_at desc to get the latest row.
CREATE INDEX IF NOT EXISTS idx_spa_participant_acted_at
  ON public.session_participant_actions (store_uuid, participant_id, acted_at DESC);

-- Secondary index for audit/replay queries by actor.
CREATE INDEX IF NOT EXISTS idx_spa_actor
  ON public.session_participant_actions (store_uuid, acted_by_membership_id, acted_at DESC);
