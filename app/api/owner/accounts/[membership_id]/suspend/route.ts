import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-NEXT-API — POST /api/owner/accounts/[membership_id]/suspend
 *
 * Owner-only. Allowed transition (LOCKED):
 *   approved -> suspended
 *
 * Forbidden: any other source status (pending/rejected/suspended → 409).
 *
 * On success:
 *   - status = suspended
 *   - audit_events row written (action=account_suspended)
 *
 * Note: store_memberships has no suspended_by/suspended_at columns in the
 * current schema; suspension actor + timestamp are captured in the audit
 * event (after.suspended_by / after.suspended_at) per design lock.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { membership_id } = await params
    if (!membership_id || !isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }

    let body: { reason?: string } = {}
    try { body = (await request.json()) ?? {} } catch { body = {} }
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: target } = await supabase
      .from("store_memberships")
      .select("id, profile_id, store_uuid, status")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const oldStatus = target.status as "pending" | "approved" | "rejected" | "suspended"
    if (oldStatus !== "approved") {
      return NextResponse.json(
        { error: "INVALID_STATUS_TRANSITION", message: `Cannot suspend from status '${oldStatus}'.` },
        { status: 409 }
      )
    }

    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("store_memberships")
      .update({
        status: "suspended",
        updated_at: nowIso,
      })
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)

    if (updateError) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    const { error: auditError } = await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "store_memberships",
      entity_id: membership_id,
      action: "account_suspended",
      before: { status: oldStatus },
      after: {
        status: "suspended",
        target_membership_id: membership_id,
        target_profile_id: target.profile_id,
        suspended_by: authContext.user_id,
        suspended_at: nowIso,
      },
      reason,
    })
    if (auditError) {
      return NextResponse.json({ error: "AUDIT_FAILED" }, { status: 500 })
    }

    return NextResponse.json({
      membership_id,
      old_status: oldStatus,
      new_status: "suspended",
      action: "account_suspended",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
