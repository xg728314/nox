import type { SupabaseClient } from "@supabase/supabase-js"

type UpdateUnreadInput = {
  store_uuid: string
  roomId: string
  membership_id: string
}

type UpdateUnreadResult = {
  last_read_message_id: string | null
  read_at: string | null
}

/**
 * Marks a room as read: upserts read cursor, inserts evidence row,
 * resets unread_count.
 *
 * Extracts the read-marking logic from rooms/[id]/read/route.ts POST handler.
 * Handles empty rooms (no messages) gracefully.
 */
export async function updateUnreadState(
  supabase: SupabaseClient,
  input: UpdateUnreadInput
): Promise<UpdateUnreadResult> {
  // Find newest non-deleted message
  const { data: latest } = await supabase
    .from("chat_messages")
    .select("id, created_at")
    .eq("chat_room_id", input.roomId)
    .eq("store_uuid", input.store_uuid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latest) {
    // Empty room — just clear unread badge
    await supabase
      .from("chat_participants")
      .update({ unread_count: 0 })
      .eq("chat_room_id", input.roomId)
      .eq("membership_id", input.membership_id)
      .eq("store_uuid", input.store_uuid)
    return { last_read_message_id: null, read_at: null }
  }

  const readAt = new Date().toISOString()

  // 1. Upsert fast cursor
  await supabase
    .from("chat_read_cursors")
    .upsert(
      {
        store_uuid: input.store_uuid,
        room_id: input.roomId,
        membership_id: input.membership_id,
        last_read_message_id: latest.id,
        last_read_at: readAt,
        updated_at: readAt,
      },
      { onConflict: "room_id,membership_id" }
    )

  // 2. Evidence row (idempotent — swallow 23505 duplicate)
  const { error: evErr } = await supabase
    .from("chat_message_reads")
    .insert({
      store_uuid: input.store_uuid,
      room_id: input.roomId,
      message_id: latest.id,
      membership_id: input.membership_id,
      read_at: readAt,
    })
  if (evErr) {
    const code = (evErr as { code?: string }).code
    if (code !== "23505") {
      console.warn("[chat/read] evidence insert failed:", evErr.message)
    }
  }

  // 3. Reset room-level unread badge
  await supabase
    .from("chat_participants")
    .update({ unread_count: 0, last_read_message_id: latest.id })
    .eq("chat_room_id", input.roomId)
    .eq("membership_id", input.membership_id)
    .eq("store_uuid", input.store_uuid)

  return { last_read_message_id: latest.id, read_at: readAt }
}
