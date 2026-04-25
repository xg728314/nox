import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { signedPaperLedgerUrl } from "@/lib/storage/paperLedgerBucket"

/**
 * GET /api/reconcile/list?date=YYYY-MM-DD&limit=50
 *
 * R27: 그날 업로드된 종이장부 목록. owner/manager 만.
 *
 * 응답:
 *   { items: [{ id, sheet_kind, business_date, status, uploaded_at,
 *               file_name, signed_url, has_extraction, has_diff,
 *               match_status }] }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const dateParam = url.searchParams.get("date")
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10)
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, limitParam)) : 50

    const supabase = supa()
    let query = supabase
      .from("paper_ledger_snapshots")
      .select("id, sheet_kind, business_date, status, uploaded_at, file_name, storage_path")
      .eq("store_uuid", auth.store_uuid)
      .is("archived_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(limit)

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      query = query.eq("business_date", dateParam)
    }

    const { data: snaps, error } = await query
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }

    const items = await Promise.all(
      (snaps ?? []).map(async (s) => {
        const row = s as {
          id: string
          sheet_kind: string
          business_date: string
          status: string
          uploaded_at: string
          file_name: string | null
          storage_path: string
        }
        const signed = await signedPaperLedgerUrl(supabase, row.storage_path).catch(() => null)
        // extraction / diff 존재 여부 (1줄 lookup — count head=true 가 빠름)
        const [{ count: extC }, { count: diffC }, { data: diffRow }] = await Promise.all([
          supabase
            .from("paper_ledger_extractions")
            .select("*", { count: "exact", head: true })
            .eq("snapshot_id", row.id),
          supabase
            .from("paper_ledger_diffs")
            .select("*", { count: "exact", head: true })
            .eq("snapshot_id", row.id),
          supabase
            .from("paper_ledger_diffs")
            .select("match_status")
            .eq("snapshot_id", row.id)
            .order("computed_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        return {
          id: row.id,
          sheet_kind: row.sheet_kind,
          business_date: row.business_date,
          status: row.status,
          uploaded_at: row.uploaded_at,
          file_name: row.file_name,
          signed_url: signed,
          has_extraction: (extC ?? 0) > 0,
          has_diff: (diffC ?? 0) > 0,
          match_status: (diffRow as { match_status?: string } | null)?.match_status ?? null,
        }
      }),
    )

    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
