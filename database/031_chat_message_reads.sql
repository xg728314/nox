-- STEP-009.7: message-level read tracking.
--
-- Two related tables:
--   chat_message_reads   — exact evidence of "membership M read message X"
--   chat_read_cursors    — denormalised "last read message" pointer per
--                          (room, membership) used for fast unread math and
--                          for efficient per-message read_count aggregation.
--
-- Both tables are store-scoped. RLS stays disabled for MVP; route-level
-- store_uuid + chat_participants membership checks enforce access control.
--
-- Uniqueness:
--   chat_message_reads.(room_id, message_id, membership_id) — a member
--     never records the same read twice.
--   chat_read_cursors.(room_id, membership_id) — one cursor per member per
--     room.

CREATE TABLE IF NOT EXISTS chat_message_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  room_id uuid NOT NULL,
  message_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_message_reads_room_msg_member
  ON chat_message_reads (room_id, message_id, membership_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message
  ON chat_message_reads (message_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_member_room
  ON chat_message_reads (membership_id, room_id);


CREATE TABLE IF NOT EXISTS chat_read_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  room_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  last_read_message_id uuid NULL,
  last_read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_read_cursors_room_member
  ON chat_read_cursors (room_id, membership_id);

CREATE INDEX IF NOT EXISTS idx_chat_read_cursors_member
  ON chat_read_cursors (membership_id);
