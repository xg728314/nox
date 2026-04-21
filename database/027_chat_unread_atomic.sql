-- 027: atomic chat unread increment (STEP-008.3)
--
-- Replaces the read-modify-write loop in app/api/chat/messages/route.ts
-- POST handler. The old pattern SELECTed each recipient's unread_count and
-- then UPDATEd to value+1, losing increments under concurrent sends.
--
-- This function increments every recipient's unread_count by 1 in a single
-- atomic UPDATE, explicitly excluding:
--   - the sender's own row (p_sender_membership_id)
--   - rows with left_at IS NOT NULL (participants who left the room)
--
-- Returned integer is the number of rows touched — the POST handler ignores
-- the value but it's useful for debugging / audit.
--
-- SECURITY DEFINER is intentionally NOT used. The route calls this via the
-- service_role client, which already bypasses RLS and has full table
-- privilege; the function runs with invoker rights and relies on the caller's
-- scope (the route has already verified chat_room_id belongs to the caller's
-- store and that the caller is a participant).

CREATE OR REPLACE FUNCTION increment_chat_unread(
  p_chat_room_id UUID,
  p_sender_membership_id UUID
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE chat_participants
  SET unread_count = unread_count + 1
  WHERE chat_room_id = p_chat_room_id
    AND membership_id <> p_sender_membership_id
    AND left_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
