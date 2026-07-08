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
  // 모바일 클라이언트 호환 alias
  title: string
  last_message: string | null
  unread_count: number
  pinned_at: string | null
  is_creator: boolean
  // 참여자 이름 (상위 5명). 그룹 채팅방의 이름 자동 생성 + UI 표시용.
  participant_names: string[]
  participant_count: number
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

  // R-inter-store (2026-07-08): chat_participants 없어도 owner/manager 는
  //   inter_store 방 접근 가능. 조기 종료 대신 빈 배열로 진행.
  if (participations.length === 0) {
    // inter_store 방만 조회해서 반환
    if (role === "owner" || role === "manager") {
      const { data: interRoom } = await supabase
        .from("chat_rooms")
        .select("id, store_uuid, type, session_id, room_uuid, name, last_message_text, last_message_at, is_active, created_by, created_at")
        .eq("type", "inter_store")
        .eq("is_active", true)
        .maybeSingle()
      if (interRoom) {
        const r = interRoom as RoomRow
        return [{
          ...r,
          display_name: r.name ?? "🏢 실장 통합 톡",
          title: r.name ?? "🏢 실장 통합 톡",
          last_message: r.last_message_text,
          unread_count: 0,
          pinned_at: null,
          is_creator: false,
          participant_names: [],
          participant_count: 0,
        }]
      }
    }
    return []
  }

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

  // 4b. group 채팅방 참여자 이름 fetch — 이름 미설정 시 자동 표시용
  //     (모든 group room 에 대해 본인 제외 참여자 최대 5명)
  const groupRoomIds = rooms.filter((r) => r.type === "group").map((r) => r.id)
  const groupParticipantNames = new Map<string, string[]>() // roomId → 이름 배열
  const groupParticipantCounts = new Map<string, number>() // roomId → 전체 수
  if (groupRoomIds.length > 0) {
    const { data: gpRows } = await supabase
      .from("chat_participants")
      .select("chat_room_id, membership_id, store_uuid")
      .in("chat_room_id", groupRoomIds)
      .is("left_at", null)
    const roomMembers = new Map<string, { id: string; storeUuid: string }[]>()
    const allMemIds = new Set<string>()
    for (const r of gpRows ?? []) {
      const arr = roomMembers.get(r.chat_room_id) ?? []
      arr.push({ id: r.membership_id, storeUuid: r.store_uuid })
      roomMembers.set(r.chat_room_id, arr)
      allMemIds.add(r.membership_id)
    }
    // 매장별 그룹화 — resolveMemberNames 가 store 별 처리
    const byStore = new Map<string, string[]>()
    for (const r of gpRows ?? []) {
      const arr = byStore.get(r.store_uuid) ?? []
      arr.push(r.membership_id)
      byStore.set(r.store_uuid, arr)
    }
    const nameMap = new Map<string, string>()
    for (const [storeId, ids] of byStore) {
      const m = await resolveMemberNames(supabase, storeId, ids)
      for (const [k, v] of m) nameMap.set(k, v)
    }
    // 본인 제외 + 최대 5명
    for (const [roomId, members] of roomMembers) {
      const others = members.filter((m) => m.id !== membership_id)
      groupParticipantCounts.set(roomId, members.length)
      const names: string[] = []
      for (const m of others) {
        const n = nameMap.get(m.id)
        if (n) names.push(n)
        if (names.length >= 5) break
      }
      groupParticipantNames.set(roomId, names)
    }
  }

  // 5. Enrich rooms
  let enriched: EnrichedRoom[] = rooms.map((r) => {
    let displayName: string
    if (r.type === "direct") {
      displayName = peerNameMap.get(r.id) || "1:1 채팅"
    } else if (r.type === "global") {
      displayName = r.name || "매장 전체"
    } else if (r.type === "group") {
      // group: 사용자 설정 이름 우선. default ("그룹 채팅") 또는 빈 값이면 참여자 이름으로.
      const customName = r.name && r.name.trim() !== "" && r.name !== "그룹 채팅"
      if (customName) {
        displayName = r.name!
      } else {
        const names = groupParticipantNames.get(r.id) ?? []
        const total = groupParticipantCounts.get(r.id) ?? names.length
        const shown = names.slice(0, 3)
        const rest = Math.max(0, total - 1 - shown.length) // -1 = 본인
        if (shown.length === 0) displayName = "그룹 채팅"
        else displayName = shown.join(", ") + (rest > 0 ? ` 외 ${rest}명` : "")
      }
    } else {
      displayName = r.name || "룸 채팅"
    }
    return {
      ...r,
      display_name: displayName,
      title: displayName, // 모바일 클라이언트 호환
      last_message: r.last_message_text,
      unread_count: unreadMap.get(r.id) || 0,
      pinned_at: pinnedAtMap.get(r.id) ?? null,
      is_creator: r.created_by === membership_id,
      participant_names: groupParticipantNames.get(r.id) ?? [],
      participant_count: groupParticipantCounts.get(r.id) ?? 0,
    }
  })

  // R-inter-store (2026-07-08): 모든 owner/manager 에게 inter_store 방 자동 추가.
  //   chat_participants JOIN 없이 role 기반 노출 — 카톡 대체 목적.
  //   super_admin 도 포함.
  const canAccessInterStore = role === "owner" || role === "manager"
  if (canAccessInterStore) {
    const { data: interRoom } = await supabase
      .from("chat_rooms")
      .select("id, store_uuid, type, session_id, room_uuid, name, last_message_text, last_message_at, is_active, created_by, created_at")
      .eq("type", "inter_store")
      .eq("is_active", true)
      .maybeSingle()
    if (interRoom) {
      const r = interRoom as RoomRow
      // 이미 목록에 있으면 skip (중복 방지)
      if (!enriched.some((e) => e.id === r.id)) {
        enriched.unshift({
          ...r,
          display_name: r.name ?? "🏢 실장 통합 톡",
          title: r.name ?? "🏢 실장 통합 톡",
          last_message: r.last_message_text,
          unread_count: 0,
          pinned_at: null,
          is_creator: false,
          participant_names: [],
          participant_count: 0,
        })
      }
    }
  }

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
