import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * POST /api/credits — 외상 등록
 * GET  /api/credits — 외상 목록 조회 (?status=pending|collected|cancelled)
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to create credits." },
        { status: 403 }
      )
    }

    let body: {
      session_id?: string
      receipt_id?: string
      business_day_id?: string
      room_uuid?: string
      manager_membership_id?: string
      customer_name?: string
      customer_phone?: string
      amount?: number
      memo?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { session_id, receipt_id, business_day_id, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo } = body

    // 필수 필드 검증 (3종 구조)
    if (!room_uuid || !isValidUUID(room_uuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "room_uuid is required and must be a valid UUID." },
        { status: 400 }
      )
    }
    if (!manager_membership_id || !isValidUUID(manager_membership_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "manager_membership_id is required and must be a valid UUID." },
        { status: 400 }
      )
    }
    if (!customer_name || customer_name.trim().length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "customer_name is required." },
        { status: 400 }
      )
    }
    if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "amount must be a positive number." },
        { status: 400 }
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

    // 방 존재 확인
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", room_uuid)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (!room) {
      return NextResponse.json(
        { error: "ROOM_NOT_FOUND", message: "Room not found in this store." },
        { status: 404 }
      )
    }

    // 담당실장 멤버십 확인
    const { data: managerMembership } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("id", manager_membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "manager")
      .eq("status", "approved")
      .maybeSingle()

    if (!managerMembership) {
      return NextResponse.json(
        { error: "MANAGER_NOT_FOUND", message: "Manager membership not found in this store." },
        { status: 404 }
      )
    }

    // INSERT
    const insertData: Record<string, unknown> = {
      store_uuid: authContext.store_uuid,
      room_uuid,
      manager_membership_id,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone?.trim() || null,
      amount,
      memo: memo?.trim() || null,
      status: "pending",
    }

    if (session_id && isValidUUID(session_id)) insertData.session_id = session_id
    if (receipt_id && isValidUUID(receipt_id)) insertData.receipt_id = receipt_id
    if (business_day_id && isValidUUID(business_day_id)) insertData.business_day_id = business_day_id

    const { data: credit, error: insertError } = await supabase
      .from("credits")
      .insert(insertData)
      .select("id, store_uuid, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo, status, session_id, receipt_id, business_day_id, created_at")
      .single()

    if (insertError || !credit) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "Failed to create credit." },
        { status: 500 }
      )
    }

    // Audit
    await supabase
      .from("audit_events")
      .insert({
        store_uuid: authContext.store_uuid,
        actor_profile_id: authContext.user_id,
        actor_membership_id: authContext.membership_id,
        actor_role: authContext.role,
        actor_type: authContext.role,
        session_id: session_id || null,
        entity_table: "credits",
        entity_id: credit.id,
        action: "credit_created",
        after: {
          room_uuid,
          manager_membership_id,
          customer_name: customer_name.trim(),
          amount,
          status: "pending",
        },
      })

    return NextResponse.json(credit, { status: 201 })
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view credits." },
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

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get("status")

    let query = supabase
      .from("credits")
      .select("id, store_uuid, session_id, receipt_id, business_day_id, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo, status, collected_at, collected_by, linked_account_id, created_at, updated_at")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (statusFilter && ["pending", "collected", "cancelled"].includes(statusFilter)) {
      query = query.eq("status", statusFilter)
    }

    // 실장은 자기 담당 외상만
    if (authContext.role === "manager") {
      query = query.eq("manager_membership_id", authContext.membership_id)
    }

    const { data: credits, error: queryError } = await query

    if (queryError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query credits." },
        { status: 500 }
      )
    }

    // 방 이름, 실장 이름 조회
    const roomUuids = [...new Set((credits ?? []).map((c: { room_uuid: string }) => c.room_uuid))]
    const managerIds = [...new Set((credits ?? []).map((c: { manager_membership_id: string }) => c.manager_membership_id))]

    const roomNameMap = new Map<string, string>()
    const managerNameMap = new Map<string, string>()

    if (roomUuids.length > 0) {
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("id", roomUuids)
      for (const r of rooms ?? []) roomNameMap.set(r.id, r.name)
    }

    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from("managers")
        .select("membership_id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("membership_id", managerIds)
      for (const m of managers ?? []) managerNameMap.set(m.membership_id, m.name)
    }

    const enriched = (credits ?? []).map((c: {
      id: string; store_uuid: string; session_id: string | null; receipt_id: string | null;
      business_day_id: string | null; room_uuid: string; manager_membership_id: string;
      customer_name: string; customer_phone: string | null; amount: number; memo: string | null;
      status: string; collected_at: string | null; collected_by: string | null;
      linked_account_id: string | null;
      created_at: string; updated_at: string
    }) => ({
      ...c,
      room_name: roomNameMap.get(c.room_uuid) || null,
      manager_name: managerNameMap.get(c.manager_membership_id) || null,
    }))

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      credits: enriched,
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
