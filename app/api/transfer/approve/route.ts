import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to approve transfers." },
        { status: 403 }
      )
    }

    let body: { transfer_id?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { transfer_id } = body
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
      .select("*")
      .eq("id", transfer_id)
      .single()

    if (fetchError || !transfer) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Transfer request not found." },
        { status: 404 }
      )
    }

    if (transfer.status !== "pending") {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: `Transfer is already '${transfer.status}'. Only 'pending' can be approved.` },
        { status: 400 }
      )
    }

    // 2. Determine which side the caller is approving from
    const callerStore = authContext.store_uuid
    const isFromStore = callerStore === transfer.from_store_uuid
    const isToStore = callerStore === transfer.to_store_uuid

    if (!isFromStore && !isToStore) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Your store is not part of this transfer." },
        { status: 403 }
      )
    }

    // 3. Check if already approved by this side
    if (isFromStore && transfer.from_store_approved_by) {
      return NextResponse.json(
        { error: "ALREADY_APPROVED", message: "From-store has already approved." },
        { status: 409 }
      )
    }
    if (isToStore && transfer.to_store_approved_by) {
      return NextResponse.json(
        { error: "ALREADY_APPROVED", message: "To-store has already approved." },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const beforeState = {
      status: transfer.status,
      from_store_approved_by: transfer.from_store_approved_by,
      to_store_approved_by: transfer.to_store_approved_by,
    }

    // 4. Update approval for this side
    const updateData: Record<string, any> = {}
    if (isFromStore) {
      updateData.from_store_approved_by = authContext.user_id
      updateData.from_store_approved_at = now
    } else {
      updateData.to_store_approved_by = authContext.user_id
      updateData.to_store_approved_at = now
    }

    // Check if BOTH sides are now approved
    const fromApproved = isFromStore ? true : !!transfer.from_store_approved_by
    const toApproved = isToStore ? true : !!transfer.to_store_approved_by
    const fullyApproved = fromApproved && toApproved

    if (fullyApproved) {
      updateData.status = "approved"
    }

    const { data: updated, error: updateError } = await supabase
      .from("transfer_requests")
      .update(updateData)
      .eq("id", transfer_id)
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "Failed to update transfer request." },
        { status: 500 }
      )
    }

    // 5. If fully approved, update hostess membership is_primary
    if (fullyApproved) {
      // Set old membership is_primary = false
      await supabase
        .from("store_memberships")
        .update({ is_primary: false })
        .eq("id", transfer.hostess_membership_id)
        .eq("store_uuid", transfer.from_store_uuid)
        .is("deleted_at", null)

      // Check if hostess already has membership at destination store
      const { data: existingMem } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("profile_id", (
          await supabase
            .from("store_memberships")
            .select("profile_id")
            .eq("id", transfer.hostess_membership_id)
            .single()
        ).data?.profile_id)
        .eq("store_uuid", transfer.to_store_uuid)
        .maybeSingle()

      if (existingMem) {
        // Activate existing membership at destination
        await supabase
          .from("store_memberships")
          .update({ is_primary: true, status: "approved" })
          .eq("id", existingMem.id)
          .eq("store_uuid", transfer.to_store_uuid)
          .is("deleted_at", null)
      } else {
        // Get profile_id from source membership
        const { data: srcMem } = await supabase
          .from("store_memberships")
          .select("profile_id")
          .eq("id", transfer.hostess_membership_id)
          .single()

        if (srcMem) {
          // Create new membership at destination store
          await supabase
            .from("store_memberships")
            .insert({
              profile_id: srcMem.profile_id,
              store_uuid: transfer.to_store_uuid,
              role: "hostess",
              status: "approved",
              is_primary: true,
              approved_by: authContext.user_id,
              approved_at: now,
            })
        }
      }
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
        entity_id: transfer_id,
        action: fullyApproved ? "transfer_fully_approved" : "transfer_side_approved",
        before: beforeState,
        after: {
          status: updated.status,
          from_store_approved_by: updated.from_store_approved_by,
          to_store_approved_by: updated.to_store_approved_by,
          approved_side: isFromStore ? "from_store" : "to_store",
          fully_approved: fullyApproved,
        },
      })

    return NextResponse.json({
      ...updated,
      fully_approved: fullyApproved,
      approved_side: isFromStore ? "from_store" : "to_store",
    })

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
