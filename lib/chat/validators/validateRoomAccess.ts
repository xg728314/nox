import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Verifies the caller is an active chat participant (left_at IS NULL).
 *
 * Extracts the repeated participant active-row check from messages POST/GET,
 * pin PATCH, and read POST routes.
 *
 * Returns null if access is granted, or a NextResponse error.
 */
export async function verifyActiveParticipant(
  supabase: SupabaseClient,
  chatRoomId: string,
  membershipId: string
): Promise<NextResponse | null> {
  const { data: participant } = await supabase
    .from("chat_participants")
    .select("id")
    .eq("chat_room_id", chatRoomId)
    .eq("membership_id", membershipId)
    .is("left_at", null)
    .maybeSingle()

  if (!participant) {
    return NextResponse.json(
      { error: "NOT_PARTICIPANT", message: "이 채팅방의 참여자가 아닙니다." },
      { status: 403 }
    )
  }

  return null
}

/**
 * Defense-in-depth: hostess can only access room_session chats
 * they participate in as session_participants.
 *
 * Extracts the repeated hostess session-participant check from
 * rooms POST and messages POST/GET.
 *
 * Returns null if access is granted, or a NextResponse error.
 */
export async function verifyHostessSessionAccess(
  supabase: SupabaseClient,
  sessionId: string,
  membershipId: string,
  store_uuid: string
): Promise<NextResponse | null> {
  const { data: sp } = await supabase
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("membership_id", membershipId)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (!sp) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "해당 세션의 참여자가 아닙니다." },
      { status: 403 }
    )
  }

  return null
}
