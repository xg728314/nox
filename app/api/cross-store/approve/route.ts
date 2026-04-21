import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess cannot approve/reject cross-store work records." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{ record_id?: string; action?: string; reject_reason?: string }>(request)
    if (parsed.error) return parsed.error
    const { record_id, action, reject_reason } = parsed.body

    if (!record_id || !action) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "record_id and action are required." }, { status: 400 })
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action must be 'approve' or 'reject'." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. Fetch record
    const { data: record, error: recordError } = await supabase
      .from("cross_store_work_records")
      .select("id, session_id, business_day_id, working_store_uuid, origin_store_uuid, hostess_membership_id, status")
      .eq("id", record_id)
      .is("deleted_at", null)
      .maybeSingle()

    if (recordError || !record) {
      return NextResponse.json({ error: "RECORD_NOT_FOUND", message: "Cross-store work record not found." }, { status: 404 })
    }

    // Verify caller's store is either working or origin
    const callerStore = authContext.store_uuid
    if (record.working_store_uuid !== callerStore && record.origin_store_uuid !== callerStore) {
      return NextResponse.json({ error: "STORE_MISMATCH", message: "This record does not belong to your store." }, { status: 403 })
    }

    if (record.status !== "pending") {
      return NextResponse.json({ error: "INVALID_STATUS", message: "Record is not in pending status. Current: " + record.status }, { status: 400 })
    }

    // 3. Update status
    const newStatus = action === "approve" ? "approved" : "rejected"
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      approved_by: authContext.user_id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (action === "reject" && reject_reason) {
      updatePayload.reject_reason = reject_reason
    }

    const { data: updated, error: updateError } = await supabase
      .from("cross_store_work_records")
      .update(updatePayload)
      .eq("id", record_id)
      .select("id, status, approved_by, approved_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updateError?.message || "Failed to update record." }, { status: 500 })
    }

    // 4. Audit
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id: record.session_id,
      entity_table: "cross_store_work_records",
      entity_id: record_id,
      action: action === "approve" ? "cross_store_work_approved" : "cross_store_work_rejected",
      before: { status: "pending" },
      after: { status: newStatus, approved_by: authContext.user_id, reject_reason: reject_reason || null },
    })

    return NextResponse.json({
      record_id: updated.id,
      session_id: record.session_id,
      working_store_uuid: record.working_store_uuid,
      origin_store_uuid: record.origin_store_uuid,
      hostess_membership_id: record.hostess_membership_id,
      status: updated.status,
      approved_by: updated.approved_by,
      approved_at: updated.approved_at,
    })
  } catch (error) {
    return handleRouteError(error, "cross-store/approve")
  }
}
