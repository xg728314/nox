import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { defaultRoomName } from "@/lib/rooms/formatRoomLabel"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active")
      .eq("store_uuid", authContext.store_uuid)
      .order("sort_order", { ascending: true })

    if (roomsError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query rooms." },
        { status: 500 }
      )
    }

    // Fetch active + recently closed sessions for all rooms in this store
    // Try with customer fields first; fall back to base fields if columns don't exist yet
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
      .eq("store_uuid", authContext.store_uuid)
      .in("status", ["active", "closed"])

    if (!sessErr1 && sessionsWithCustomer) {
      allSessions = sessionsWithCustomer
    } else {
      // Fallback: customer columns may not exist yet (migration 014 not applied)
      const { data: sessionsBase } = await supabase
        .from("room_sessions")
        .select("id, room_uuid, status, started_at, ended_at, manager_name")
        .eq("store_uuid", authContext.store_uuid)
        .in("status", ["active", "closed"])
      allSessions = sessionsBase
    }

    // For closed sessions, only keep those from today's business day (or last 6 hours)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const activeSessions = (allSessions ?? []).filter(s => s.status === "active")
    const closedSessions = (allSessions ?? []).filter(s =>
      s.status === "closed" && s.ended_at && s.ended_at > sixHoursAgo
    )

    type SessionInfo = { id: string; status: string; started_at: string; ended_at?: string | null; participant_count: number; gross_total: number; participant_total: number; order_total: number; manager_name: string | null; customer_name_snapshot: string | null; customer_party_size: number }
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
          .is("deleted_at", null),
        supabase
          .from("orders")
          .select("session_id, customer_amount")
          .in("session_id", sessionIds)
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

    // Fetch today's business_day
    const today = new Date().toISOString().split("T")[0]
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    const roomsWithSessions = (rooms ?? []).map((room: { id: string; room_no: string; room_name: string; is_active: boolean }) => ({
      ...room,
      session: sessionMap.get(room.id) || null,
      closed_session: closedSessionMap.get(room.id) || null,
    }))

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      business_day_id: bizDay?.id || null,
      rooms: roomsWithSessions,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}

/**
 * POST /api/rooms — 새 방 추가 (다음 번호 자동 생성)
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Find the highest room_no to determine next number
    const { data: existing } = await supabase
      .from("rooms")
      .select("room_no, sort_order")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)

    const maxSort = existing?.[0]?.sort_order ?? 0
    const nextNum = maxSort + 1
    const roomNo = String(nextNum)
    const roomName = defaultRoomName(nextNum)

    const { data: room, error: insertError } = await supabase
      .from("rooms")
      .insert({
        store_uuid: authContext.store_uuid,
        room_no: roomNo,
        room_name: roomName,
        sort_order: nextNum,
        is_active: true,
      })
      .select("id, room_no, room_name, is_active, sort_order")
      .single()

    if (insertError || !room) {
      console.error("[rooms POST] insert failed:", insertError?.message)
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "방 생성에 실패했습니다." },
        { status: 500 }
      )
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "rooms",
      entity_id: room.id,
      action: "room_created",
      after: { room_no: roomNo, room_name: roomName, sort_order: nextNum },
    })

    return NextResponse.json({ room }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
