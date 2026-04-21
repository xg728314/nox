-- 026: chat_rooms room_session unique index fix (STEP-008.2)
--
-- The original partial unique index in database/005_chat.sql filtered on
-- `type = 'room'`, but the API at app/api/chat/rooms/route.ts has always
-- inserted `type = 'room_session'`. The old index therefore never matched
-- any live row, and multiple chat_rooms for the same session_id could be
-- created concurrently without any SQL-level guarantee — the route's
-- SELECT-then-INSERT pattern would even return 500 via .maybeSingle() when
-- two duplicates collided on read.
--
-- This migration:
--   1. Deduplicates existing room_session rows per session_id, keeping the
--      most recent created_at and soft-deactivating the rest via is_active.
--      No hard delete — historical message rows still reference the old
--      chat_room_id via FK and must not be orphaned.
--   2. Drops the broken index.
--   3. Creates a correctly-filtered partial unique index on active
--      room_session rows only, so deactivated duplicates from step 1 do not
--      collide with the live winner.

-- Step 1: deactivate duplicate room_session rows.
-- For each session_id that has more than one active room_session chat_room,
-- keep the newest and mark the rest is_active = false.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id) AS rn
  FROM chat_rooms
  WHERE type = 'room_session'
    AND session_id IS NOT NULL
    AND is_active = true
)
UPDATE chat_rooms
SET is_active = false,
    updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: drop the broken index.
DROP INDEX IF EXISTS idx_chat_rooms_session_unique;

-- Step 3: create the correctly-filtered partial unique index.
-- Only ACTIVE room_session rows are constrained; inactive duplicates from
-- step 1 remain readable but cannot collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_session_unique
  ON chat_rooms(session_id)
  WHERE type = 'room_session' AND session_id IS NOT NULL AND is_active = true;
