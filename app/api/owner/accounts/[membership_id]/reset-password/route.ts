import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-NEXT-API — POST /api/owner/accounts/[membership_id]/reset-password
 *
 * Owner-triggered password reset.
 *
 * Strict rules (LOCKED):
 *   - owner only
 *   - target membership must belong to the same store_uuid
 *   - target status MUST be approved
 *   - response MUST NOT leak whether email is registered externally
 *     (the route accepts membership_id, not email — but the response
 *      shape is identical for missing target and approved target to
 *      keep behavior aligned with the unauth /api/auth/reset-password
 *      privacy posture)
 *   - audit_events row MUST be written
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
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Same-store + approved gate
    const { data: target } = await admin
      .from("store_memberships")
      .select("id, profile_id, store_uuid, status")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    if (target.status !== "approved") {
      return NextResponse.json(
        { error: "INVALID_TARGET_STATUS", message: "Reset only allowed for approved accounts." },
        { status: 409 }
      )
    }

    // Resolve email via auth admin
    const { data: userData } = await admin.auth.admin.getUserById(target.profile_id)
    const email = userData?.user?.email ?? null

    // Best-effort send via anon client. We do NOT surface auth errors to
    // the caller so account existence cannot be probed via timing.
    // HOTFIX: explicit redirectTo → /reset-password/confirm so the recovery
    // link does not fall back to Site URL (root → /login which loses tokens).
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      request.headers.get("origin") ||
      (() => {
        const proto = request.headers.get("x-forwarded-proto") || "https"
        const host = request.headers.get("host")
        return host ? `${proto}://${host}` : null
      })()
    const redirectTo = origin ? `${origin}/reset-password/confirm` : undefined
    let sendOk = false
    if (email) {
      try {
        const anon = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
        sendOk = true
      } catch {
        // swallow
      }
    }

    // Audit — mandatory
    const nowIso = new Date().toISOString()
    const { error: auditError } = await admin.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "store_memberships",
      entity_id: membership_id,
      action: "account_reset_password_sent",
      before: { status: target.status },
      after: {
        target_membership_id: membership_id,
        target_profile_id: target.profile_id,
        send_attempted: Boolean(email),
        send_ok: sendOk,
        sent_at: nowIso,
      },
      reason,
    })
    if (auditError) {
      return NextResponse.json({ error: "AUDIT_FAILED" }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      membership_id,
      message: "비밀번호 재설정 메일이 발송되었습니다.",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
