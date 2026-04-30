import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveMemberNames } from "@/lib/chat/queries/loadRoomMembers"

type ParticipationRow = {
  chat_room_id: string
  unread_count: number
  last_read_message_id?: string | null
  pinned_at?: string | null
}

type RoomRow = {
  id: string
  store_uuid: string
  type: string
  session_id: string | null
  room_uuid: string | null
  name: string | null
  last_message_text: string | null
  last_message_at: string | null
  is_active: boolean
  closed_at?: string | null
  closed_reason?: string | null
  created_by: string | null
  created_at: string
}

type EnrichedRoom = RoomRow & {
  display_name: string
  unread_count: number
  pinned_at: string | null
  is_creator: boolean
}

/**
 * Fetches the caller's chat room list with unread counts, pin state,
 * peer names for DM rooms, and personal sort order.
 *
 * Extracts the room list assembly from rooms/route.ts GET handler.
 * Uses two-step DB fallback for migration-sensitive columns.
 *
 * 2026-05-01 R-Hostess-Home: role 인자 추가.
 *   "스태프" (role === "staff" || "hostess") 는 매장 전체 (global) /
 *   그룹 (group) 채팅방을 list 에서 제외. 운영자 의도: 스태프는 본인 방
 *   채팅 (room_session) 과 DM (direct) 만 보여야 함.
 *
 *   chat_participants 에 row 가 있어도 (super_admin 의 base 가 owner 였을
 *   때 자동 가입한 흔적 등) effective role 이 "스태프" 면 응답에서 제외.
 *   서버 측 단일 진실 공급원.
 */
export async function getRoomList(
  supabase: SupabaseClient,
  store_uuid: string,
  membership_id: string,
  role?: string,
): Promise<EnrichedRoom[]> {
  const isStaffRole = role === "hostess" || role === "staff"
  // 1. Load participations (two-step fallback for pinned_at column)
  let participations: ParticipationRow[] = []
  {
    const full = await supabase
      .from("chat_participants")
      .select("chat_room_id, unread_count, last_read_message_id, pinned_at")
      .eq("membership_id", membership_id)
      .eq("store_uuid", store_uuid)
      .is("left_at", null)
    if (full.error) {
      console.warn("[chat/rooms GET] full participations select failed, retrying base:", full.error.message)
      const base = await supabase
        .from("chat_participants")
        .select("chat_room_id, unread_count, last_read_message_id")
        .eq("membership_id", membership_id)
        .eq("store_uuid", store_uuid)
        .is("left_at", null)
      if (base.error) {
        console.error("[chat/rooms GET] base participations select failed:", base.error.message)
        return []
      }
      participations = (base.data ?? []) as ParticipationRow[]
    } else {
      participations = (full.data ?? []) as ParticipationRow[]
    }
  }

  if (participations.length === 0) return []

  const roomIds = participations.map((p) => p.chat_room_id)

  // 2. Load rooms (two-step fallback for closed_at/closed_reason columns)
  let rooms: RoomRow[] = []
  {
    const full = await supabase
      .from("chat_rooms")
      .select("id, store_uuid, type, session_id, room_uuid, name, last_message_text, last_message_at, is_active, closed_at, closed_reason, created_by, created_at")
      .in("id", roomIds)
      .eq("store_uuid", store_uuid)
      .eq("is_active", true)
      .order("last_message_at", { ascending: false, nullsFirst: false })
    if (full.error) {
      console.warn("[chat/rooms GET] full rooms select failed, retrying base:", full.error.message)
      const base = await supabase
        .from("chat_rooms")
        .select("id, store_uuid, type, session_id, room_uuid, name, last_message_text, last_message_at, is_active, created_by, created_at")
        .in("id", roomIds)
        .eq("store_uuid", store_uuid)
        .eq("is_active", true)
        .order("last_message_at", { ascending: false, nullsFirst: false })
      if (base.error) {
        console.error("[chat/rooms GET] base rooms select failed:", base.error.message)
        return []
      }
      rooms = (base.data ?? []) as RoomRow[]
    } else {
      rooms = (full.data ?? []) as RoomRow[]
    }
  }

  // 3. Build unread + pinned maps
  const unreadMap = new Map<string, number>()
  const pinnedAtMap = new Map<string, string | null>()
  for (const p of participations) {
    unreadMap.set(p.chat_room_id, p.unread_count)
    pinnedAtMap.set(p.chat_room_id, p.pinned_at ?? null)
  }

  // 4. Resolve peer names for direct rooms
  const directRoomIds = rooms
    .filter((r) => r.type === "direct")
    .map((r) => r.id)

  const peerNameMap = new Map<string, string>()
  if (directRoomIds.length > 0) {
    const { data: allParticipants } = await supabase
      .from("chat_participants")
      .select("chat_room_id, membership_id")
      .in("chat_room_id", directRoomIds)
      .is("left_at", null)

    const peerMembershipIds = new Set<string>()
    const roomPeerMap = new Map<string, string>()
    for (const p of allParticipants ?? []) {
      if (p.membership_id !== membership_id) {
        peerMembershipIds.add(p.membership_id)
        roomPeerMap.set(p.chat_room_id, p.membership_id)
      }
    }

    if (peerMembershipIds.size > 0) {
      const nameMap = await resolveMemberNames(supabase, store_uuid, [...peerMembershipIds])
      for (const [roomId, peerId] of roomPeerMap) {
        const name = nameMap.get(peerId)
        if (name) peerNameMap.set(roomId, name)
      }
    }
  }

  // 5. Enrich rooms
  let enriched: EnrichedRoom[] = rooms.map((r) => ({
    ...r,
    display_name: r.type === "direct" ? (peerNameMap.get(r.id) || "1:1 채팅") : (r.name || (r.type === "global" ? "매장 전체" : "룸 채팅")),
    unread_count: unreadMap.get(r.id) || 0,
    pinned_at: pinnedAtMap.get(r.id) ?? null,
    is_creator: r.created_by === membership_id,
  }))

  // 5b. 2026-05-01 R-Hostess-Home: 스태프(staff/hostess) 면 global / group 제외.
  //   chat_participants row 가 남아있어도 (super_admin override 시점의 잔재
  //   또는 과거 owner/manager 시점 자동 가입) 스태프 시점에서는 list 에 X.
  //   허용: room_session (본인 방 채팅) + direct (DM).
  if (isStaffRole) {
    enriched = enriched.filter(
      (r) => r.type === "direct" || r.type === "room_session" || r.type === "room",
    )
  }

  // 6. Personal sort: pinned > unread > recency
  enriched.sort((a, b) => {
    const aPin = a.pinned_at ? new Date(a.pinned_at).getTime() : 0
    const bPin = b.pinned_at ? new Date(b.pinned_at).getTime() : 0
    if (aPin !== bPin) return bPin - aPin
    if (a.unread_count !== b.unread_count) return b.unread_count - a.unread_count
    const aLast = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bLast = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return bLast - aLast
  })

  return enriched
}
