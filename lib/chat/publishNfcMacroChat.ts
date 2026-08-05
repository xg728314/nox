/**
 * R-nfc-phase3 (2026-07-29): NFC 이벤트 confirmed → 매크로 채팅 발행.
 *
 * 발행 대상 우선순위:
 *   1. actor 의 담당실장 그룹채팅 (있으면)
 *   2. 매장 전체톡 (global)
 *
 * 매크로 포맷 (tag_type 별):
 *   room         → "✅ [3번방] 지수 · 셔츠 완메 메이드 (23:42)"
 *   waiter_call  → "🔔 웨이터 호출 · 3번방 (23:42)"
 *   purchase     → "🛒 사입 요청 · 3번방 (23:42)"
 *   toilet       → "🚻 화장실 이동 · 지수 (23:42)"
 *   manager_call → "📢 실장 호출 · 3번방 (23:42)"
 */
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

type Event = {
  id: string
  store_uuid: string
  room_uuid: string | null
  tag_type: string
  actor_membership_id: string | null
  session_id: string | null
  participant_id: string | null
  scanned_at: string
  confirmed_at?: string | null
}

export async function publishNfcMacroChat(input: {
  auth: AuthContext | null
  event: Event
}): Promise<{ published: boolean; chat_room_id?: string; reason?: string }> {
  const { event } = input
  try {
    const sb = getServiceClient()

    // 1) actor 이름 · 담당실장 · session 종목/티켓 lookup
    let actorName = ""
    let managerMembershipId: string | null = null
    if (event.actor_membership_id) {
      const { data: mem } = await sb
        .from("store_memberships")
        .select("profile_id")
        .eq("id", event.actor_membership_id)
        .maybeSingle()
      if (mem?.profile_id) {
        const { data: prof } = await sb
          .from("profiles")
          .select("full_name")
          .eq("id", mem.profile_id)
          .maybeSingle()
        actorName = (prof as { full_name?: string } | null)?.full_name ?? ""
      }
      // 담당실장 lookup (hostesses 테이블)
      const { data: hostess } = await sb
        .from("hostesses")
        .select("manager_membership_id")
        .eq("membership_id", event.actor_membership_id)
        .maybeSingle()
      managerMembershipId = (hostess as { manager_membership_id?: string } | null)?.manager_membership_id ?? null
    }

    // 2) room_no lookup
    let roomNo: string | null = null
    if (event.room_uuid) {
      const { data: room } = await sb
        .from("rooms")
        .select("room_no")
        .eq("id", event.room_uuid)
        .maybeSingle()
      roomNo = (room as { room_no?: string } | null)?.room_no ?? null
    }

    // 3) participant 세부 (종목/티켓) lookup
    let categoryDisplay = ""
    let ticketDisplay = ""
    if (event.participant_id) {
      const { data: part } = await sb
        .from("session_participants")
        .select("category, time_minutes")
        .eq("id", event.participant_id)
        .maybeSingle()
      const p = part as { category?: string; time_minutes?: number } | null
      if (p) {
        categoryDisplay = p.category ?? ""
        // ticket 유도 (완메/반티/차3)
        const tm = p.time_minutes ?? 0
        if (tm <= 8) ticketDisplay = "무료"
        else if (tm <= 15) ticketDisplay = "차3"
        else {
          const half = p.category === "퍼블릭" ? 45 : 30
          if (tm <= half + 10) ticketDisplay = "반티"
          else ticketDisplay = "완메"
        }
      }
    }

    // 4) 대상 채팅방 결정: 담당실장 group chat 우선 → 매장 전체톡 fallback
    let chatRoomId: string | null = null
    if (managerMembershipId) {
      const { data: gr } = await sb
        .from("chat_rooms")
        .select("id")
        .eq("type", "group")
        .eq("created_by", managerMembershipId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (gr) chatRoomId = (gr as { id: string }).id
    }
    if (!chatRoomId) {
      const { data: gr2 } = await sb
        .from("chat_rooms")
        .select("id")
        .eq("type", "global")
        .eq("store_uuid", event.store_uuid)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()
      if (gr2) chatRoomId = (gr2 as { id: string }).id
    }
    if (!chatRoomId) return { published: false, reason: "no_chat_room" }

    // 5) 매크로 텍스트 조립
    const t = new Date(event.confirmed_at ?? event.scanned_at)
    const hh = String(t.getHours()).padStart(2, "0")
    const mm = String(t.getMinutes()).padStart(2, "0")
    const timeStr = `${hh}:${mm}`
    let content = ""
    switch (event.tag_type) {
      case "room": {
        const parts: string[] = ["✅"]
        if (roomNo) parts.push(`[${roomNo}번방]`)
        if (actorName) parts.push(actorName)
        if (categoryDisplay) parts.push(categoryDisplay)
        if (ticketDisplay) parts.push(ticketDisplay)
        parts.push("메이드")
        parts.push(`(${timeStr})`)
        content = parts.join(" ")
        break
      }
      case "waiter_call":
        content = `🔔 웨이터 호출 · ${roomNo ? roomNo + "번방" : "매장"} (${timeStr})`
        break
      case "purchase":
        content = `🛒 사입 요청 · ${roomNo ? roomNo + "번방" : "매장"}${actorName ? " · " + actorName : ""} (${timeStr})`
        break
      case "toilet":
        content = `🚻 화장실 이동${actorName ? " · " + actorName : ""} (${timeStr})`
        break
      case "manager_call":
        content = `📢 실장 호출 · ${roomNo ? roomNo + "번방" : "매장"} (${timeStr})`
        break
      default:
        content = `📌 NFC 이벤트 · ${event.tag_type} (${timeStr})`
    }

    // 6) chat_messages INSERT
    //    sender_membership_id: actor 있으면 actor · 없으면 event.confirmed_by (auth)
    //    시스템 auto_confirm 인 경우 auth 는 null 가능성 → actor 로 fallback
    const senderId = input.auth?.membership_id ?? event.actor_membership_id
    if (!senderId) return { published: false, reason: "no_sender" }

    const nowIso = new Date().toISOString()
    const { error: insErr } = await sb.from("chat_messages").insert({
      chat_room_id: chatRoomId,
      store_uuid: event.store_uuid,
      sender_membership_id: senderId,
      content,
      message_type: "text",
      created_at: nowIso,
    })
    if (insErr) return { published: false, reason: insErr.message }

    // 이벤트에 chat_broadcast_at · chat_room_id 스탬프
    await sb
      .from("nfc_scan_events")
      .update({ chat_broadcast_at: nowIso, chat_room_id: chatRoomId })
      .eq("id", event.id)

    // chat_rooms last message 갱신
    await sb
      .from("chat_rooms")
      .update({ last_message_text: content, last_message_at: nowIso, updated_at: nowIso })
      .eq("id", chatRoomId)
      .then(() => { /* best-effort */ })

    return { published: true, chat_room_id: chatRoomId }
  } catch (e) {
    return { published: false, reason: e instanceof Error ? e.message : "unknown" }
  }
}
