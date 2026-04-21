import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"

/**
 * GET    /api/customers/[customer_id] — 고객 상세 + 방문 이력
 * PATCH  /api/customers/[customer_id] — 고객 정보 수정 (memo, tags, phone)
 * POST   /api/customers/[customer_id]/merge — 고객 병합 (CUSTOMER-7)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ customer_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { customer_id } = await params

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Fetch customer
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("id, name, phone, memo, tags, manager_membership_id, created_at, updated_at")
      .eq("id", customer_id)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (custErr || !customer) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    // 2. Fetch visit history (sessions linked to this customer)
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, started_at, ended_at, status, manager_name, customer_party_size, business_day_id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("customer_id", customer_id)
      .order("started_at", { ascending: false })
      .limit(50)

    const visits: {
      session_id: string
      room_label: string
      started_at: string
      ended_at: string | null
      status: string
      manager_name: string | null
      party_size: number
      gross_total: number
      participant_count: number
      receipt_snapshots: { id: string; receipt_type: string; created_at: string }[]
    }[] = []

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id)
      const roomUuids = [...new Set(sessions.map((s: { room_uuid: string }) => s.room_uuid))]

      // Fetch room labels
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, room_no, room_name")
        .in("id", roomUuids)

      const roomMap = new Map<string, string>()
      if (rooms) {
        for (const r of rooms) {
          roomMap.set(r.id, formatRoomLabel(r))
        }
      }

      // Fetch receipts for gross_total
      const { data: receipts } = await supabase
        .from("receipts")
        .select("session_id, gross_total")
        .in("session_id", sessionIds)
        .eq("store_uuid", authContext.store_uuid)

      const receiptMap = new Map<string, number>()
      if (receipts) {
        for (const r of receipts) {
          receiptMap.set(r.session_id, r.gross_total)
        }
      }

      // Fetch participant counts
      const { data: participantCounts } = await supabase
        .from("session_participants")
        .select("session_id")
        .in("session_id", sessionIds)
        .eq("role", "hostess")
        .is("deleted_at", null)

      const pCountMap = new Map<string, number>()
      if (participantCounts) {
        for (const p of participantCounts) {
          pCountMap.set(p.session_id, (pCountMap.get(p.session_id) || 0) + 1)
        }
      }

      // Fetch receipt snapshots for each session (CUSTOMER-5)
      const { data: snapshots } = await supabase
        .from("receipt_snapshots")
        .select("id, session_id, receipt_type, created_at")
        .in("session_id", sessionIds)
        .eq("store_uuid", authContext.store_uuid)
        .order("created_at", { ascending: false })

      const snapMap = new Map<string, { id: string; receipt_type: string; created_at: string }[]>()
      if (snapshots) {
        for (const s of snapshots) {
          const list = snapMap.get(s.session_id) || []
          list.push({ id: s.id, receipt_type: s.receipt_type, created_at: s.created_at })
          snapMap.set(s.session_id, list)
        }
      }

      for (const s of sessions) {
        visits.push({
          session_id: s.id,
          room_label: roomMap.get(s.room_uuid) || "",
          started_at: s.started_at,
          ended_at: s.ended_at ?? null,
          status: s.status,
          manager_name: s.manager_name ?? null,
          party_size: s.customer_party_size ?? 0,
          gross_total: receiptMap.get(s.id) ?? 0,
          participant_count: pCountMap.get(s.id) ?? 0,
          receipt_snapshots: snapMap.get(s.id) ?? [],
        })
      }
    }

    // 3. Compute stats (CUSTOMER-6)
    const totalVisits = visits.length
    const totalAmount = visits.reduce((s, v) => s + v.gross_total, 0)
    const avgAmount = totalVisits > 0 ? Math.round(totalAmount / totalVisits) : 0
    const lastVisit = visits.length > 0 ? visits[0].started_at : null

    return NextResponse.json({
      customer,
      stats: {
        total_visits: totalVisits,
        total_amount: totalAmount,
        avg_amount: avgAmount,
        last_visit: lastVisit,
      },
      visits,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    console.error("[customer detail] unexpected:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customer_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { customer_id } = await params

    let body: { name?: string; phone?: string; memo?: string; tags?: string[] }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.phone !== undefined) updateData.phone = body.phone ? body.phone.replace(/\D/g, "") : null
    if (body.memo !== undefined) updateData.memo = body.memo?.trim() || null
    if (body.tags !== undefined) updateData.tags = body.tags

    const { data: updated, error: updateError } = await supabase
      .from("customers")
      .update(updateData)
      .eq("id", customer_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("id, name, phone, memo, tags, updated_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "customers",
      entity_id: customer_id,
      action: "customer_updated",
      after: updateData,
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
