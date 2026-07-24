import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * R30-B (2026-07-24): 참여자 체크인 성공 후 담당실장의 그룹 채팅방에
 *   자동으로 발행. 프로토타입 "구릅톡 자동 발행" 매칭.
 *
 * 채팅방 선택 우선 순위:
 *   1) 실장이 만든 group 채팅방 (chat_rooms.type='group' AND created_by=실장 membership_id)
 *   2) 매장 전체톡 (chat_rooms.type='global' AND store_uuid=본 매장) — fallback
 *   3) 어느 것도 없으면 조용히 skip (에러 안 던짐)
 *
 * best-effort: 실패해도 참여자 등록 flow 는 계속.
 */

type PublishInput = {
  auth: AuthContext
  storeUuid: string
  storeName?: string | null
  roomNo?: string | null
  hostessNames: string[]
  category?: string | null
  ticket?: string | null
}

export async function publishManagerCheckinMessage(input: PublishInput): Promise<{ published: boolean; chat_room_id?: string; reason?: string }> {
  try {
    const sb = getServiceClient()

    // 1) 실장 그룹 채팅방 우선
    let chatRoomId: string | null = null
    try {
      const { data: groupRoom } = await sb
        .from("chat_rooms")
        .select("id")
        .eq("type", "group")
        .eq("created_by", input.auth.membership_id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (groupRoom) chatRoomId = (groupRoom as { id: string }).id
    } catch { /* silent */ }

    // 2) 매장 전체톡 fallback
    if (!chatRoomId) {
      try {
        const { data: globalRoom } = await sb
          .from("chat_rooms")
          .select("id")
          .eq("type", "global")
          .eq("store_uuid", input.storeUuid)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle()
        if (globalRoom) chatRoomId = (globalRoom as { id: string }).id
      } catch { /* silent */ }
    }

    if (!chatRoomId) {
      return { published: false, reason: "no_chat_room" }
    }

    const nowIso = new Date().toISOString()
    const nameList = input.hostessNames.filter(Boolean).join("·")
    const parts: string[] = ["✓"]
    if (input.storeName) parts.push(input.storeName)
    if (input.roomNo) parts.push(`${input.roomNo}번방`)
    if (nameList) parts.push(nameList)
    if (input.category) parts.push(input.category)
    if (input.ticket) parts.push(input.ticket)
    const content = parts.join(" · ")

    const { error: insErr } = await sb
      .from("chat_messages")
      .insert({
        chat_room_id: chatRoomId,
        store_uuid: input.storeUuid,
        sender_membership_id: input.auth.membership_id,
        content,
        message_type: "text",
        created_at: nowIso,
      })
    if (insErr) return { published: false, reason: insErr.message }

    // last_message_at 갱신
    try {
      await sb
        .from("chat_rooms")
        .update({ last_message_text: content, last_message_at: nowIso, updated_at: nowIso })
        .eq("id", chatRoomId)
    } catch { /* best-effort */ }

    return { published: true, chat_room_id: chatRoomId }
  } catch (e) {
    return { published: false, reason: e instanceof Error ? e.message : "unknown" }
  }
}
