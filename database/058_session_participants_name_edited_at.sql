-- ============================================================
-- 058_session_participants_name_edited_at.sql
--
-- Move "has this participant's external_name been edited?" flag
-- from an audit_events SELECT scan to a dedicated column on
-- session_participants.
--
-- WHY:
--   /api/manager/participants and /api/rooms/{room_uuid}/participants
--   both issued a `audit_events IN (participant_ids) WHERE
--   entity_table='session_participants' AND action='update_external_name'`
--   query to compute the name_edited badge. That query had no
--   store_uuid filter (CLAUDE.md skill-01 violation) and no time
--   window, so on large deployments it scanned an ever-growing
--   audit_events table. Seen in production as a bootstrap tail
--   latency source.
--
-- APPROACH:
--   Add `session_participants.name_edited_at TIMESTAMPTZ` (nullable).
--   The write path (lib/session/services/participantActions/
--   updateExternalName.ts) sets it to `now()` when the name changes.
--   The read paths drop the audit_events SELECT entirely and derive
--   `name_edited = name_edited_at IS NOT NULL` from the row itself
--   (no extra round-trip).
--
-- AUDIT TRAIL IS UNCHANGED:
--   audit_events remains the source of truth for the full edit
--   history (who/when/before/after). This column is a cached flag
--   for the hot UI read path, not a replacement for audit logs.
--
-- BACKFILL:
--   For existing rows, set name_edited_at to the most recent
--   `update_external_name` audit event's created_at. Idempotent —
--   re-running updates nothing because the WHERE clause filters out
--   rows that already have a value set.
--
-- ============================================================

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS name_edited_at TIMESTAMPTZ;

-- Backfill from existing audit_events. Uses DISTINCT ON to pick the
-- latest update per participant. Only writes rows whose
-- name_edited_at is still NULL, so this is safe to re-run.
UPDATE session_participants sp
SET name_edited_at = ae.latest_edit_at
FROM (
  SELECT DISTINCT ON (entity_id)
    entity_id,
    created_at AS latest_edit_at
  FROM audit_events
  WHERE entity_table = 'session_participants'
    AND action = 'update_external_name'
  ORDER BY entity_id, created_at DESC
) ae
WHERE sp.id::text = ae.entity_id
  AND sp.name_edited_at IS NULL;

COMMENT ON COLUMN session_participants.name_edited_at IS
  'Cached flag: most recent update_external_name timestamp. Written by participantActions.updateExternalName on name change. Read by /api/manager/participants and /api/rooms/{room_uuid}/participants as a replacement for scanning audit_events.';
