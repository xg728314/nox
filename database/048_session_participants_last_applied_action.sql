-- 048_session_participants_last_applied_action.sql
--
-- Adds an idempotency cursor to `session_participants` for the
-- operator-action application flow introduced in this round.
--
-- `last_applied_action_id` points at the most recent row from
-- `session_participant_actions` that has already been applied to this
-- participant. The apply route loads all actions for the participant in
-- acted_at-ascending order, locates this cursor, and only processes
-- rows AFTER it. When the cursor is null, every recorded action is
-- unapplied.
--
-- The column is nullable and the FK is ON DELETE SET NULL so that a
-- hypothetical future cleanup of the append-only action log (not
-- planned) cannot leave dangling references that would break the
-- participant row.

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS last_applied_action_id uuid
    REFERENCES public.session_participant_actions(id) ON DELETE SET NULL;

-- Small index to look up which participants still have unapplied work
-- (e.g., for a future batched sweep). `session_participants` already
-- has plenty of per-session indexes so we only add one targeted at the
-- new column.
CREATE INDEX IF NOT EXISTS idx_session_participants_last_applied_action
  ON public.session_participants (last_applied_action_id);
