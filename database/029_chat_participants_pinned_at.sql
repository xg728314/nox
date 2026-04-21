-- 029: chat_participants.pinned_at — per-user chat room pin (STEP-009.3)
--
-- Personal pin, not global. `chat_participants` already has one row per
-- (chat_room_id, membership_id), which is exactly the right scope — adding
-- pinned_at to this table keeps the pin private to each participant and
-- never affects other users' ordering.
--
-- TIMESTAMPTZ instead of boolean: doubles as both "is pinned" (IS NOT NULL)
-- and "when was it pinned" (for stable ordering across multiple pins). NULL
-- means unpinned.

ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
