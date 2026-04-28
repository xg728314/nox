import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { isValidUUID } from "@/lib/validation"

/**
 * DELETE /api/reconcile/grants/[id]
 *
 * R-Auth: 종이장부 권한 revoke (soft — revoked_at + revoked_by 박음).
 * hard delete 안 함 — audit 가능 + revoke 이력 보관.
 *
 * 권한: owner only (부여한 사람과 무관 — 매장 owner 누구나 revoke 가능).
 * 매장 스코프: grant.store_uuid === auth.store_uuid 강제.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "id 는 UUID." }, { status: 400 })
    }

    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner 만 권한을 회수할 수 있습니다." }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null

    const supabase = supa()

    // grant 조회 + 매장 스코프
    const { data: grant } = await supabase
      .from("paper_ledger_access_grants")
      .select("id, store_uuid, membership_id, kind, action, scope_type, business_date, date_start, date_end, expires_at, revoked_at")
      .eq("id", id)
      .maybeSingle()
    if (!grant) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const g = grant as {
      id: string; store_uuid: string; membership_id: string; kind: string; action: string
      scope_type: string; business_date: string | null; date_start: string | null; date_end: string | null
      expires_at: string; revoked_at: string | null
    }
    if (g.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }
    if (g.revoked_at) {
      return NextResponse.json({ error: "ALREADY_REVOKED", message: "이미 회수된 권한입니다." }, { status: 409 })
    }

    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("paper_ledger_access_grants")
      .update({
        revoked_at: nowIso,
        revoked_by: auth.user_id,
        // reason 은 grant 의 원래 reason 과 별개 — 회수 사유는 audit metadata 에 박음
      })
      .eq("id", id)
    if (updErr) {
      return NextResponse.json({ error: "DB_UPDATE_FAILED", message: updErr.message }, { status: 500 })
    }

    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_grant_revoked",
      entity_table: "paper_ledger_access_grants",
      entity_id: id,
      status: "success",
      before: {
        kind: g.kind,
        grant_action: g.action,
        scope_type: g.scope_type,
        business_date: g.business_date,
        date_start: g.date_start,
        date_end: g.date_end,
        expires_at: g.expires_at,
      },
      metadata: {
        target_membership_id: g.membership_id,
        revoked_at: nowIso,
      },
      reason,
    })

    return NextResponse.json({ ok: true, revoked_at: nowIso })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
