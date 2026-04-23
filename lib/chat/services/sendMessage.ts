import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

type SendInput = {
  chat_room_id: string
  store_uuid: string
  sender_membership_id: string
  content: string
}

type SendResult =
  | { message: { id: string; chat_room_id: string; sender_membership_id: string; content: string; message_type: string; created_at: string }; error?: never }
  | { message?: never; error: NextResponse }

/**
 * Inserts a chat message, updates room last_message, increments unread for others.
 *
 * Extracts the message send logic from messages/route.ts POST handler.
 */
export async function sendMessage(
  supabase: SupabaseClient,
  input: SendInput
): Promise<SendResult> {
  // 1. Insert message
  const { data: message, error: insertErr } = await supabase
    .from("chat_messages")
    .insert({
      chat_room_id: input.chat_room_id,
      store_uuid: input.store_uuid,
      sender_membership_id: input.sender_membership_id,
      content: input.content.trim(),
      message_type: "text",
    })
    .select("id, chat_room_id, sender_membership_id, content, message_type, created_at")
    .single()

  if (insertErr || !message) {
    return {
      error: NextResponse.json(
        { error: "SEND_FAILED", message: "메시지 전송에 실패했습니다." },
        { status: 500 }
      ),
    }
  }

  // 2. Update room last_message
  await supabase
    .from("chat_rooms")
    .update({
      last_message_text: input.content.trim().slice(0, 100),
      last_message_at: message.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.chat_room_id)
    .eq("store_uuid", input.store_uuid)
    .is("deleted_at", null)

  // 3. Increment unread for other participants via atomic RPC
  await supabase.rpc("increment_chat_unread", {
    p_chat_room_id: input.chat_room_id,
    p_sender_membership_id: input.sender_membership_id,
  })

  return { message }
}
