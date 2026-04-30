import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { signedPaperLedgerUrl } from "@/lib/storage/paperLedgerBucket"
import { resolveFeatureAccess, RECONCILE_ROLE_DEFAULTS } from "@/lib/auth/featureAccess"

/**
 * GET /api/reconcile/[id]
 *
 * R27: 단일 snapshot 상세. 사진 signed URL + 최신 extraction + 최신 edit + 최신 diff.
 *
 * 응답:
 *   { snapshot, signed_url, extraction, latest_edit, diff }
 *   - extraction: AI 가 만든 원본 추출 (참조용 — 항상 보존).
 *   - latest_edit: 사용자가 편집한 최신본 (있으면 UI 가 우선 사용).
 *   - diff: 최신 비교 결과.
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
    const snapshot = snap as {
      store_uuid: string
      storage_path: string
      business_date: string
    } & Record<string, unknown>
    if (snapshot.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // R-Auth: business_date 별 view 권한 검증
    const access = await resolveFeatureAccess(supabase, auth, {
      table: "paper_ledger_access_grants",
      store_uuid: snapshot.store_uuid,
      business_date: snapshot.business_date,
      action: "view",
      role_defaults: RECONCILE_ROLE_DEFAULTS,
    })
    if (!access.allowed) {
      return NextResponse.json(
        { error: "ACCESS_DENIED", message: "이 날짜의 종이장부 보기 권한이 없습니다.", via: access.via },
        { status: 403 },
      )
    }

    // 2026-04-30 fix: latest paper_ledger_edits 도 fetch.
    //   증상: 사용자가 StaffEditor 에서 편집 + 저장 후 새로고침 시 "내용
    //   다 삭제됨" 으로 보임. 원인: 이 API 가 extracted_json (AI 원본)
    //   만 반환 → page.tsx 가 편집 전 데이터 표시. paper_ledger_edits
    //   는 DB 에 살아있는데 UI 가 못 읽음.
    //   Fix: 응답에 latest_edit 추가. page.tsx 가 latest_edit 우선 사용.
    const [signedUrl, extractionRes, diffRes, editRes] = await Promise.all([
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
      supabase
        .from("paper_ledger_edits")
        .select("id, base_extraction_id, edited_json, edit_reason, edited_by, edited_at")
        .eq("snapshot_id", id)
        .order("edited_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const extraction = extractionRes.data
    const diff = diffRes.data
    const latest_edit = editRes.data

    return NextResponse.json({
      snapshot,
      signed_url: signedUrl,
      extraction,
      latest_edit,
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
