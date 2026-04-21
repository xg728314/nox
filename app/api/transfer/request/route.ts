import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to create transfer requests." },
        { status: 403 }
      )
    }

    let body: {
      hostess_membership_id?: string
      to_store_uuid?: string
      reason?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { hostess_membership_id, to_store_uuid, reason } = body

    if (!hostess_membership_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_membership_id is required." },
        { status: 400 }
      )
    }
    if (!to_store_uuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "to_store_uuid is required." },
        { status: 400 }
      )
    }

    // Cannot transfer to same store
    if (to_store_uuid === authContext.store_uuid) {
      return NextResponse.json(
        { error: "SAME_STORE", message: "Cannot transfer to the same store." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Verify hostess membership belongs to caller's store
    const { data: membership, error: memError } = await supabase
      .from("store_memberships")
      .select("id, profile_id, store_uuid, role, status, is_primary")
      .eq("id", hostess_membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .single()

    if (memError || !membership) {
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_FOUND", message: "Hostess membership not found in your store." },
        { status: 404 }
      )
    }

    if (membership.status !== "approved") {
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_APPROVED", message: "Hostess membership is not approved." },
        { status: 403 }
      )
    }

    // 2. Verify destination store exists
    const { data: destStore, error: destError } = await supabase
      .from("stores")
      .select("id")
      .eq("id", to_store_uuid)
      .single()

    if (destError || !destStore) {
      return NextResponse.json(
        { error: "DEST_STORE_NOT_FOUND", message: "Destination store not found." },
        { status: 404 }
      )
    }

    // 3. Check for duplicate pending request
    const { data: existing } = await supabase
      .from("transfer_requests")
      .select("id")
      .eq("hostess_membership_id", hostess_membership_id)
      .eq("from_store_uuid", authContext.store_uuid)
      .eq("to_store_uuid", to_store_uuid)
      .eq("status", "pending")
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: "DUPLICATE_REQUEST", message: "A pending transfer request already exists." },
        { status: 409 }
      )
    }

    // 4. Get business_day
    const today = new Date().toISOString().split("T")[0]
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    const businessDayId = bizDay?.id ?? null

    // 5. INSERT transfer_request
    const { data: transfer, error: insertError } = await supabase
      .from("transfer_requests")
      .insert({
        hostess_membership_id,
        from_store_uuid: authContext.store_uuid,
        to_store_uuid,
        business_day_id: businessDayId,
        status: "pending",
        reason: reason || null,
      })
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, status, reason, created_at")
      .single()

    if (insertError || !transfer) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "Failed to create transfer request." },
        { status: 500 }
      )
    }

    // 6. Audit event
    await supabase
      .from("audit_events")
      .insert({
        store_uuid: authContext.store_uuid,
        actor_profile_id: authContext.user_id,
        actor_membership_id: authContext.membership_id,
        actor_role: authContext.role,
        actor_type: authContext.role,
        entity_table: "transfer_requests",
        entity_id: transfer.id,
        action: "transfer_requested",
        after: {
          hostess_membership_id,
          from_store_uuid: authContext.store_uuid,
          to_store_uuid,
          status: "pending",
          reason: reason || null,
        },
      })

    return NextResponse.json(transfer, { status: 201 })

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
