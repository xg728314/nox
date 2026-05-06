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
  // 2026-05-06 fix: chat_rooms 테이블에는 deleted_at 컬럼이 없음 (migration 005
  //   에 ADD 한 적 없고, 후속 028 도 closed_at/closed_reason 만 추가). 기존
  //   `.is("deleted_at", null)` 필터가 PG 42703 (column does not exist) → throw
  //   → 500. is_active 로 대체 (chat_rooms 의 soft-close 플래그).
  //
  //   증상: "매장 전체 메세지 보내기 에러 500" 사용자 보고.
  //
  //   2단계와 3단계는 메시지 INSERT 가 이미 성공한 후의 부수 작업이므로
  //   await 제거 — 백그라운드 fire 로 응답 latency 도 단축 (~150-300ms).
  void supabase
    .from("chat_rooms")
    .update({
      last_message_text: input.content.trim().slice(0, 100),
      last_message_at: message.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.chat_room_id)
    .eq("store_uuid", input.store_uuid)
    .eq("is_active", true)
    .then(undefined, () => {
      /* 메시지 자체는 이미 INSERT 됐으므로 last_message 갱신 실패는 silent. */
    })

  // 3. Increment unread for other participants via atomic RPC (background).
  void supabase
    .rpc("increment_chat_unread", {
      p_chat_room_id: input.chat_room_id,
      p_sender_membership_id: input.sender_membership_id,
    })
    .then(undefined, () => {
      /* swallow — unread 갱신 실패는 메시지 전송 자체와 무관. */
    })

  return { message }
}
