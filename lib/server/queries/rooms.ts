import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type SessionInfo = {
  id: string
  status: string
  started_at: string
  ended_at?: string | null
  participant_count: number
  gross_total: number
  participant_total: number
  order_total: number
  manager_name: string | null
  customer_name_snapshot: string | null
  customer_party_size: number
}

export type RoomWithSession = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session: SessionInfo | null
  closed_session: SessionInfo | null
}

export type RoomsResponse = {
  store_uuid: string
  business_day_id: string | null
  rooms: RoomWithSession[]
}

export async function getRooms(auth: AuthContext): Promise<RoomsResponse> {
  const supabase = getServiceClient()

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_no, room_name, is_active")
    .eq("store_uuid", auth.store_uuid)
    .order("sort_order", { ascending: true })

  if (roomsError) throw new Error("Failed to query rooms.")

  type SessionRow = {
    id: string; room_uuid: string; status: string; started_at: string;
    ended_at?: string | null;
    manager_name: string | null;
    manager_membership_id?: string | null;
    customer_name_snapshot?: string | null;
    customer_party_size?: number | null;
  }
  let allSessions: SessionRow[] | null = null

  const { data: sessionsWithCustomer, error: sessErr1 } = await supabase
    .from("room_sessions")
    .select("id, room_uuid, status, started_at, ended_at, manager_name, customer_name_snapshot, customer_party_size")
    .eq("store_uuid", auth.store_uuid)
    .in("status", ["active", "closed"])

  if (!sessErr1 && sessionsWithCustomer) {
    allSessions = sessionsWithCustomer
  } else {
    const { data: sessionsBase } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status, started_at, ended_at, manager_name")
      .eq("store_uuid", auth.store_uuid)
      .in("status", ["active", "closed"])
    allSessions = sessionsBase
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const activeSessions = (allSessions ?? []).filter(s => s.status === "active")
  const closedSessions = (allSessions ?? []).filter(s =>
    s.status === "closed" && s.ended_at && s.ended_at > sixHoursAgo,
  )

  const sessionMap = new Map<string, SessionInfo>()
  const closedSessionMap = new Map<string, SessionInfo>()

  const allSessionsList = [...activeSessions, ...closedSessions]
  if (allSessionsList.length > 0) {
    const sessionIds = allSessionsList.map(s => s.id)

    const [{ data: participants }, { data: orders }] = await Promise.all([
      supabase
        .from("session_participants")
        .select("session_id, price_amount")
        .in("session_id", sessionIds)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
      supabase
        .from("orders")
        .select("session_id, customer_amount")
        .in("session_id", sessionIds)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
    ])

    const countMap = new Map<string, number>()
    const participantTotalMap = new Map<string, number>()
    if (participants) {
      for (const p of participants) {
        countMap.set(p.session_id, (countMap.get(p.session_id) || 0) + 1)
        participantTotalMap.set(p.session_id, (participantTotalMap.get(p.session_id) || 0) + (p.price_amount || 0))
      }
    }

    const orderTotalMap = new Map<string, number>()
    if (orders) {
      for (const o of orders as { session_id: string; customer_amount: number }[]) {
        orderTotalMap.set(o.session_id, (orderTotalMap.get(o.session_id) || 0) + (o.customer_amount || 0))
      }
    }

    for (const s of activeSessions) {
      const pTotal = participantTotalMap.get(s.id) || 0
      const oTotal = orderTotalMap.get(s.id) || 0
      sessionMap.set(s.room_uuid, {
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at ?? null,
        participant_count: countMap.get(s.id) || 0,
        gross_total: pTotal + oTotal,
        participant_total: pTotal,
        order_total: oTotal,
        manager_name: s.manager_name ?? null,
        customer_name_snapshot: (s as Record<string, unknown>).customer_name_snapshot as string | null ?? null,
        customer_party_size: ((s as Record<string, unknown>).customer_party_size as number) ?? 0,
      })
    }

    for (const s of closedSessions) {
      const pTotal = participantTotalMap.get(s.id) || 0
      const oTotal = orderTotalMap.get(s.id) || 0
      closedSessionMap.set(s.room_uuid, {
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at ?? null,
        participant_count: countMap.get(s.id) || 0,
        gross_total: pTotal + oTotal,
        participant_total: pTotal,
        order_total: oTotal,
        manager_name: s.manager_name ?? null,
        customer_name_snapshot: (s as Record<string, unknown>).customer_name_snapshot as string | null ?? null,
        customer_party_size: ((s as Record<string, unknown>).customer_party_size as number) ?? 0,
      })
    }
  }

  const today = new Date().toISOString().split("T")[0]
  const { data: bizDay } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_date", today)
    .maybeSingle()

  const roomsWithSessions: RoomWithSession[] = (rooms ?? []).map((room: { id: string; room_no: string; room_name: string; is_active: boolean }) => ({
    ...room,
    session: sessionMap.get(room.id) || null,
    closed_session: closedSessionMap.get(room.id) || null,
  }))

  return {
    store_uuid: auth.store_uuid,
    business_day_id: bizDay?.id || null,
    rooms: roomsWithSessions,
  }
}
