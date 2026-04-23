import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { logDeniedAudit } from "@/lib/audit/logEvent"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // owner only
    if (authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner can close operating days." },
        { status: 403 }
      )
    }

    // STEP-021: reauth gate — closing is a sensitive state-flip.
    if (requiresReauth("financial_write", authContext.role)) {
      const supabaseUrl2 = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey2 = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl2 && supabaseKey2) {
        const sbCheck = createClient(supabaseUrl2, supabaseKey2)
        const ok = await hasRecentReauth(sbCheck, authContext.user_id, "financial_write")
        if (!ok) {
          await logDeniedAudit(sbCheck, {
            auth: authContext,
            action: "sensitive_action_blocked_due_to_missing_reauth",
            entity_table: "store_operating_days",
            reason: "REAUTH_REQUIRED",
            metadata: { route: "POST /api/operating-days/close" },
          })
          return NextResponse.json(
            { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
            { status: 401 }
          )
        }
      }
    }

    let body: { business_day_id?: string; notes?: string; force?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { business_day_id, notes, force } = body
    if (!business_day_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Fetch operating day
    const { data: opDay, error: opError } = await supabase
      .from("store_operating_days")
      .select("id, store_uuid, business_date, status")
      .eq("id", business_day_id)
      .eq("store_uuid", authContext.store_uuid)
      .single()

    if (opError || !opDay) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Operating day not found in your store." },
        { status: 404 }
      )
    }

    if (opDay.status === "closed") {
      const { data: existingReport } = await supabase
        .from("closing_reports")
        .select("id, store_uuid, business_day_id, status, summary, notes, created_at, confirmed_at")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", business_day_id)
        .limit(1)
        .maybeSingle()

      return NextResponse.json(
        {
          business_day_id,
          business_date: opDay.business_date,
          status: "closed",
          closing_report: existingReport,
        },
        { status: 200 }
      )
    }

    // 2. Check no active sessions remain
    const { data: activeSessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", business_day_id)
      .eq("status", "active")

    if (activeSessions && activeSessions.length > 0) {
      return NextResponse.json(
        { error: "ACTIVE_SESSIONS_EXIST", message: `${activeSessions.length} active session(s) remain. Close all sessions before closing the day.` },
        { status: 400 }
      )
    }

    // 2.5. Check for draft (unfinalized) receipts
    const { data: draftReceipts } = await supabase
      .from("receipts")
      .select("id, session_id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", business_day_id)
      .eq("status", "draft")

    const draftCount = draftReceipts?.length ?? 0

    if (draftCount > 0 && !force) {
      return NextResponse.json(
        {
          error: "DRAFT_RECEIPTS_EXIST",
          message: `미확정 정산이 ${draftCount}건 있습니다. 확정 후 마감하거나, 강제 마감하세요.`,
          draft_count: draftCount,
          draft_session_ids: (draftReceipts ?? []).map((r: { session_id: string }) => r.session_id),
        },
        { status: 400 }
      )
    }

    // 3. Aggregate receipts for this business_day
    const { data: receipts } = await supabase
      .from("receipts")
      .select("gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", business_day_id)

    const summary = {
      total_sessions: 0,
      gross_total: 0,
      tc_total: 0,
      manager_total: 0,
      hostess_total: 0,
      margin_total: 0,
      order_total: 0,
      participant_total: 0,
    }

    if (receipts) {
      summary.total_sessions = receipts.length
      for (const r of receipts) {
        summary.gross_total += r.gross_total ?? 0
        summary.tc_total += r.tc_amount ?? 0
        summary.manager_total += r.manager_amount ?? 0
        summary.hostess_total += r.hostess_amount ?? 0
        summary.margin_total += r.margin_amount ?? 0
        summary.order_total += r.order_total_amount ?? 0
        summary.participant_total += r.participant_total_amount ?? 0
      }
    }

    const now = new Date().toISOString()

    // 4. Close operating day
    const { error: closeError } = await supabase
      .from("store_operating_days")
      .update({
        status: "closed",
        closed_at: now,
        closed_by: authContext.user_id,
      })
      .eq("id", business_day_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)

    if (closeError) {
      return NextResponse.json(
        { error: "CLOSE_FAILED", message: "Failed to close operating day." },
        { status: 500 }
      )
    }

    // Reuse the same business-day report on repeated closes.
    const { data: report, error: reportError } = await supabase
      .from("closing_reports")
      .upsert({
        store_uuid: authContext.store_uuid,
        business_day_id,
        status: "confirmed",
        summary,
        notes: notes || null,
        created_by: authContext.user_id,
        confirmed_by: authContext.user_id,
        confirmed_at: now,
      }, { onConflict: "business_day_id" })
      .select("id, store_uuid, business_day_id, status, summary, notes, created_at, confirmed_at")
      .single()

    if (reportError || !report) {
      return NextResponse.json(
        { error: "REPORT_CREATE_FAILED", message: "Operating day closed but failed to create closing report." },
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
        entity_table: "store_operating_days",
        entity_id: business_day_id,
        action: "operating_day_closed",
        before: { status: opDay.status },
        after: {
          status: "closed",
          closing_report_id: report.id,
          summary,
        },
      })

    return NextResponse.json({
      business_day_id,
      business_date: opDay.business_date,
      status: "closed",
      closing_report: report,
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
