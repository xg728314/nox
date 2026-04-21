import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to cancel transfers." },
        { status: 403 }
      )
    }

    let body: { transfer_id?: string; reason?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { transfer_id, reason } = body
    if (!transfer_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "transfer_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Fetch transfer request
    const { data: transfer, error: fetchError } = await supabase
      .from("transfer_requests")
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, status")
      .eq("id", transfer_id)
      .single()

    if (fetchError || !transfer) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Transfer request not found." },
        { status: 404 }
      )
    }

    // Only pending can be cancelled
    if (transfer.status !== "pending") {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: `Transfer is '${transfer.status}'. Only 'pending' can be cancelled.` },
        { status: 400 }
      )
    }

    // Verify caller belongs to either side
    const callerStore = authContext.store_uuid
    if (callerStore !== transfer.from_store_uuid && callerStore !== transfer.to_store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Your store is not part of this transfer." },
        { status: 403 }
      )
    }

    const beforeState = { status: transfer.status }

    // 2. Update status to cancelled
    const { data: updated, error: updateError } = await supabase
      .from("transfer_requests")
      .update({ status: "cancelled" })
      .eq("id", transfer_id)
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, status")
      .single()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "CANCEL_FAILED", message: "Failed to cancel transfer request." },
        { status: 500 }
      )
    }

    // 3. Audit event
    await supabase
      .from("audit_events")
      .insert({
        store_uuid: authContext.store_uuid,
        actor_profile_id: authContext.user_id,
        actor_membership_id: authContext.membership_id,
        actor_role: authContext.role,
        actor_type: authContext.role,
        entity_table: "transfer_requests",
        entity_id: transfer_id,
        action: "transfer_cancelled",
        reason: reason || null,
        before: beforeState,
        after: { status: "cancelled" },
      })

    return NextResponse.json(updated)

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
