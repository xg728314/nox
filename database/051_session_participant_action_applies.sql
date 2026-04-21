-- 051_session_participant_action_applies.sql
--
-- Apply-state tracking for session_participant_actions.
--
-- Strictly additive + rollback-safe:
--   - Creates exactly one new table + four indexes.
--   - Does NOT alter `session_participant_actions`.
--   - Does NOT alter `session_participants`.
--   - Does NOT add confidence / correction-score schema.
--   - Does NOT create or attach triggers (codebase convention —
--     application code maintains `updated_at` on every write).
--
-- Semantics (enforced at the application layer, not by this schema):
--   - One apply-tracking row per action row, created when an apply
--     attempt is first made. Status is the lifecycle cursor:
--         pending → success       (apply succeeded)
--         pending → failed        (apply failed; may retry)
--         failed  → pending       (retry queued)
--         pending → success/failed (retry completed)
--     `attempt_count` is incremented on every attempt. `applied_at` is
--     set only when transitioning to `success`; `failed_at` is set only
--     when transitioning to `failed`; `last_attempted_at` is updated
--     on every attempt regardless of outcome.
--   - `requested_by` is the store_memberships row that triggered the
--     apply (nullable for future automated / system paths).
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_spaa_requested_by_created;
--   DROP INDEX IF EXISTS idx_spaa_status_attempted;
--   DROP INDEX IF EXISTS idx_spaa_participant_created;
--   DROP INDEX IF EXISTS uq_spaa_action_id;
--   DROP TABLE IF EXISTS public.session_participant_action_applies;

CREATE TABLE IF NOT EXISTS public.session_participant_action_applies (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id          uuid        NOT NULL REFERENCES public.session_participant_actions(id),
  participant_id     uuid        NOT NULL REFERENCES public.session_participants(id),
  apply_status       text        NOT NULL DEFAULT 'pending'
                       CHECK (apply_status IN ('pending', 'success', 'failed')),
  attempt_count      integer     NOT NULL DEFAULT 0
                       CHECK (attempt_count >= 0),
  requested_by       uuid        REFERENCES public.store_memberships(id),
  applied_at         timestamptz,
  failed_at          timestamptz,
  last_attempted_at  timestamptz,
  failure_code       text,
  failure_message    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Exactly one apply-tracking row per action. Enforces the uniqueness
-- contract the application depends on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spaa_action_id
  ON public.session_participant_action_applies (action_id);

-- Per-participant history (recent first) for operator timeline views.
CREATE INDEX IF NOT EXISTS idx_spaa_participant_created
  ON public.session_participant_action_applies (participant_id, created_at DESC);

-- Retry / worker scan: cheap seek for stuck-pending or recently-failed
-- rows ordered by last attempt. No covering columns — the caller
-- re-reads rows by id after narrowing.
CREATE INDEX IF NOT EXISTS idx_spaa_status_attempted
  ON public.session_participant_action_applies (apply_status, last_attempted_at);

-- Per-operator audit lane. Partial — system / automated apply paths
-- that leave requested_by NULL never populate this index.
CREATE INDEX IF NOT EXISTS idx_spaa_requested_by_created
  ON public.session_participant_action_applies (requested_by, created_at DESC)
  WHERE requested_by IS NOT NULL;
