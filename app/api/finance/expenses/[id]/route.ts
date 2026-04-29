import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * /api/finance/expenses/[id] — owner only.
 * DELETE: soft-delete (deleted_at = now()).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid id" }, { status: 400 })
    }

    const supabase = supa()
    const { data: row, error: selErr } = await supabase
      .from("store_expenses")
      .select("id, store_uuid, deleted_at")
      .eq("id", id)
      .maybeSingle()
    if (selErr || !row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const r = row as { id: string; store_uuid: string; deleted_at: string | null }
    if (r.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    if (r.deleted_at) {
      return NextResponse.json({ ok: true, already: true })
    }

    const { error: delErr } = await supabase
      .from("store_expenses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
    if (delErr) {
      return NextResponse.json({ error: "DB_ERROR", message: delErr.message }, { status: 500 })
    }

    await logAuditEvent(supabase, {
      auth,
      action: "store_expense_deleted",
      entity_table: "store_expenses",
      entity_id: id,
      status: "success",
    }).catch(() => { /* best-effort */ })

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
