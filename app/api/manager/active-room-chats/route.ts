/**
 * GET /api/manager/active-room-chats
 *
 * 본 매장 active room_session 채팅방 목록.
 *   - 각 방마다 식구 명단 (본 매장 + 외부 식구 분리)
 *   - 매니저, 시작 시각, 남은 시간 (참고)
 *   - chat_room_id 가 있는 active room_session 만 노출 (없으면 클라가 채팅 진입 시 자동 sync).
 *
 * 응답:
 *   {
 *     business_day_id,
 *     rooms: [
 *       {
 *         session_id, room_uuid, room_name, room_no,
 *         chat_room_id (nullable — 첫 진입 시 동기화 필요),
 *         participants: [
 *           { membership_id, hostess_name, is_external, origin_store_name? }
 *         ],
 *         manager_name,
 *         started_at,
 *         unread_count  // chat_participants.unread_count
 *       }
 *     ]
 *   }
 *
 * 권한: owner / manager.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()

    // 오늘 영업일
    const today = getBusinessDateForOps()
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    const businessDayId = bizDay?.id ?? null
    if (!businessDayId) {
      return NextResponse.json({ business_day_id: null, rooms: [] })
    }

    // active 세션 (본 매장)
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, manager_membership_id, started_at")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("status", "active")
      .is("deleted_at", null)
    const sessionList = (sessions ?? []) as Array<{ id: string; room_uuid: string; manager_membership_id: string | null; started_at: string | null }>
    if (sessionList.length === 0) {
      return NextResponse.json({ business_day_id: businessDayId, rooms: [] })
    }
    const sessionIds = sessionList.map((s) => s.id)
    const roomUuids = Array.from(new Set(sessionList.map((s) => s.room_uuid)))

    // 방 이름
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, name, room_no")
      .eq("store_uuid", auth.store_uuid)
      .in("id", roomUuids)
      .is("deleted_at", null)
    const roomMap = new Map<string, { name: string; room_no: string | null }>()
    for (const r of (rooms ?? []) as { id: string; name: string; room_no: string | null }[]) {
      roomMap.set(r.id, { name: r.name, room_no: r.room_no })
    }

    // active participants per 세션
    const { data: parts } = await supabase
      .from("session_participants")
      .select("session_id, membership_id, store_uuid, origin_store_uuid")
      .in("session_id", sessionIds)
      .eq("status", "active")
      .is("deleted_at", null)
    const partsList = (parts ?? []) as Array<{ session_id: string; membership_id: string; store_uuid: string; origin_store_uuid: string | null }>

    // 식구 이름 + origin store name (cross-store 식별)
    const mids = Array.from(new Set(partsList.map((p) => p.membership_id)))
    const originStoreIds = Array.from(new Set(partsList.map((p) => p.origin_store_uuid).filter(Boolean) as string[]))

    const { data: hostessRows } = mids.length > 0
      ? await supabase
          .from("hostesses")
          .select("membership_id, name, store_uuid")
          .in("membership_id", mids)
      : { data: [] as Array<{ membership_id: string; name: string; store_uuid: string }> }
    const hostessMap = new Map<string, { name: string; origin_store_uuid: string }>()
    for (const h of (hostessRows ?? []) as Array<{ membership_id: string; name: string; store_uuid: string }>) {
      hostessMap.set(h.membership_id, { name: h.name, origin_store_uuid: h.store_uuid })
    }

    const storeNameMap = new Map<string, string>()
    if (originStoreIds.length > 0) {
      const { data: storeRows } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", originStoreIds)
      for (const s of (storeRows ?? []) as Array<{ id: string; store_name: string }>) {
        storeNameMap.set(s.id, s.store_name)
      }
    }

    // 매니저 이름
    const mgrMids = Array.from(new Set(sessionList.map((s) => s.manager_membership_id).filter(Boolean) as string[]))
    const mgrNameMap = new Map<string, string>()
    if (mgrMids.length > 0) {
      const { data: mgrRows } = await supabase
        .from("store_memberships")
        .select("id, profile_id, profiles!store_memberships_profile_id_fkey(full_name)")
        .in("id", mgrMids)
      type Row = { id: string; profile_id: string | null; profiles: { full_name?: string } | { full_name?: string }[] | null }
      for (const m of (mgrRows ?? []) as Row[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.full_name) mgrNameMap.set(m.id, p.full_name)
      }
    }

    // chat_room_id (있을 때만)
    const { data: chatRooms } = await supabase
      .from("chat_rooms")
      .select("id, session_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("type", "room_session")
      .in("session_id", sessionIds)
      .eq("is_active", true)
      .is("deleted_at", null)
    const chatRoomMap = new Map<string, string>()
    for (const c of (chatRooms ?? []) as Array<{ id: string; session_id: string }>) {
      chatRoomMap.set(c.session_id, c.id)
    }

    // 본인 unread
    const chatRoomIds = Array.from(chatRoomMap.values())
    const unreadMap = new Map<string, number>()
    if (chatRoomIds.length > 0) {
      const { data: parts } = await supabase
        .from("chat_participants")
        .select("chat_room_id, unread_count")
        .in("chat_room_id", chatRoomIds)
        .eq("membership_id", auth.membership_id)
      for (const p of (parts ?? []) as Array<{ chat_room_id: string; unread_count: number }>) {
        unreadMap.set(p.chat_room_id, Number(p.unread_count ?? 0))
      }
    }

    // partsBySession
    const partsBySession = new Map<string, typeof partsList>()
    for (const p of partsList) {
      if (!partsBySession.has(p.session_id)) partsBySession.set(p.session_id, [])
      partsBySession.get(p.session_id)!.push(p)
    }

    const out = sessionList
      .map((s) => {
        const sParts = partsBySession.get(s.id) ?? []
        const participants = sParts.map((p) => {
          const h = hostessMap.get(p.membership_id)
          const isExternal = !!p.origin_store_uuid && p.origin_store_uuid !== auth.store_uuid
          return {
            membership_id: p.membership_id,
            hostess_name: h?.name ?? "?",
            is_external: isExternal,
            origin_store_name: isExternal && p.origin_store_uuid
              ? storeNameMap.get(p.origin_store_uuid) ?? null
              : null,
          }
        })
        const room = roomMap.get(s.room_uuid)
        const chatRoomId = chatRoomMap.get(s.id) ?? null
        return {
          session_id: s.id,
          room_uuid: s.room_uuid,
          room_name: room?.name ?? "?",
          room_no: room?.room_no ?? null,
          chat_room_id: chatRoomId,
          unread_count: chatRoomId ? (unreadMap.get(chatRoomId) ?? 0) : 0,
          participants,
          manager_name: s.manager_membership_id ? (mgrNameMap.get(s.manager_membership_id) ?? null) : null,
          started_at: s.started_at,
        }
      })
      .filter((r) => r.participants.length > 0)
      .sort((a, b) => (a.room_no ?? "").localeCompare(b.room_no ?? ""))

    return NextResponse.json({ business_day_id: businessDayId, rooms: out })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: 401 })
    }
    console.error("[active-room-chats] error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
