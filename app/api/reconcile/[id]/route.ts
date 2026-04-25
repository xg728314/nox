import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { signedPaperLedgerUrl } from "@/lib/storage/paperLedgerBucket"

/**
 * GET /api/reconcile/[id]
 *
 * R27: 단일 snapshot 상세. 사진 signed URL + 최신 extraction + 최신 diff.
 *
 * 응답:
 *   { snapshot, signed_url, extraction, diff }
 *
 * 매장 스코프: snapshot.store_uuid === auth.store_uuid 강제.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabase = supa()
    const { data: snap, error: snapErr } = await supabase
      .from("paper_ledger_snapshots")
      .select(
        "id, store_uuid, business_day_id, business_date, sheet_kind, storage_path, file_name, mime_type, size_bytes, status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, notes",
      )
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()

    if (snapErr) {
      return NextResponse.json({ error: "DB_ERROR", message: snapErr.message }, { status: 500 })
    }
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const snapshot = snap as { store_uuid: string; storage_path: string } & Record<string, unknown>
    if (snapshot.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const [signedUrl, { data: extraction }, { data: diff }] = await Promise.all([
      signedPaperLedgerUrl(supabase, snapshot.storage_path).catch(() => null),
      supabase
        .from("paper_ledger_extractions")
        .select("id, extracted_json, vlm_model, prompt_version, cost_usd, duration_ms, unknown_tokens, created_at")
        .eq("snapshot_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("paper_ledger_diffs")
        .select("id, extraction_id, paper_owe_total_won, paper_recv_total_won, db_owe_total_won, db_recv_total_won, item_diffs, match_status, manual_overrides, reviewer_notes, computed_at")
        .eq("snapshot_id", id)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    return NextResponse.json({
      snapshot,
      signed_url: signedUrl,
      extraction,
      diff,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
