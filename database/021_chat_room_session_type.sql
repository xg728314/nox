-- 021: Chat room type rename + group support
-- "room" → "room_session" for clarity
-- Add "group" type support

-- 1. Update existing chat room types
UPDATE chat_rooms SET type = 'room_session' WHERE type = 'room';

-- 2. Drop old unique index that references type='room'
DROP INDEX IF EXISTS idx_chat_rooms_session_unique;

-- 3. Create new unique index for room_session type
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_session_unique
    ON chat_rooms(session_id) WHERE type = 'room_session' AND session_id IS NOT NULL;

-- 4. Add CHECK constraint for valid chat room types
-- (non-blocking — allows future types without migration)
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_type_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_type_check
    CHECK (type IN ('global', 'group', 'room_session', 'direct'));
