CREATE TABLE IF NOT EXISTS chat_rooms (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    type TEXT NOT NULL,
    session_id UUID REFERENCES room_sessions(id),
    room_uuid UUID REFERENCES rooms(id),
    name TEXT,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES store_memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_store ON chat_rooms(store_uuid, type);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_session ON chat_rooms(session_id) WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_global_unique
    ON chat_rooms(store_uuid) WHERE type = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_session_unique
    ON chat_rooms(session_id) WHERE type = 'room' AND session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_participants (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    last_read_message_id UUID,
    unread_count INTEGER NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_participants_unique
    ON chat_participants(chat_room_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_membership
    ON chat_participants(membership_id, store_uuid);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    sender_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room
    ON chat_messages(chat_room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_store
    ON chat_messages(store_uuid, created_at DESC);
