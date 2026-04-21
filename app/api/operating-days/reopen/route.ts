import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { logDeniedAudit } from "@/lib/audit/logEvent"

/**
 * POST /api/operating-days/reopen
 * 마감된 영업일을 다시 open으로 복원 (owner 전용)
 * body: { business_day_id, reason }
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner can reopen operating days." },
        { status: 403 }
      )
    }

    // STEP-021: reauth gate — reopening a closed day is financially sensitive.
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
            metadata: { route: "POST /api/operating-days/reopen" },
          })
          return NextResponse.json(
            { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
            { status: 401 }
          )
        }
      }
    }

    let body: { business_day_id?: string; reason?: string }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 })
    }

    const { business_day_id, reason } = body
    if (!business_day_id || !isValidUUID(business_day_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "business_day_id is required and must be a valid UUID." }, { status: 400 })
    }
    if (!reason || reason.trim().length < 2) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "reason is required (reopen 사유 필수)." }, { status: 400 })
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
      .maybeSingle()

    if (opError || !opDay) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Operating day not found." }, { status: 404 })
    }

    if (opDay.status !== "closed") {
      return NextResponse.json(
        { error: "NOT_CLOSED", message: `영업일이 '${opDay.status}' 상태입니다. closed 상태만 reopen 가능합니다.` },
        { status: 400 }
      )
    }

    // 2. Reopen
    const { error: updateError } = await supabase
      .from("store_operating_days")
      .update({
        status: "open",
        closed_at: null,
        closed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", business_day_id)

    if (updateError) {
      return NextResponse.json({ error: "REOPEN_FAILED", message: updateError.message }, { status: 500 })
    }

    // 3. Audit — reopen은 반드시 reason 기록
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "store_operating_days",
      entity_id: business_day_id,
      action: "operating_day_reopened",
      before: { status: "closed" },
      after: { status: "open" },
      reason: reason.trim(),
    })

    return NextResponse.json({
      business_day_id,
      business_date: opDay.business_date,
      status: "open",
      reason: reason.trim(),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
