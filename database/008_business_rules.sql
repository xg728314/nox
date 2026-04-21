ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS default_waiter_tip INTEGER NOT NULL DEFAULT 0;

ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS greeting_confirmed BOOLEAN NOT NULL DEFAULT false;
