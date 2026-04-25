import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { downloadPaperLedger } from "@/lib/storage/paperLedgerBucket"
import { extractFromImage } from "@/lib/reconcile/extract"
import { logAuditEvent } from "@/lib/audit/logEvent"
import type { SheetKind } from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/[id]/extract
 *
 * R28: snapshot 의 사진을 Claude Vision 으로 분석 → JSON 추출 → DB 저장.
 *
 * 권한: owner / manager.
 * 매장 스코프: snapshot.store_uuid === auth.store_uuid 강제.
 *
 * 흐름:
 *   1. snapshot 조회 + 매장 스코프 검증
 *   2. status='extracting' 으로 마킹
 *   3. Storage 다운로드 → Claude Vision 호출
 *   4. paper_ledger_extractions row insert
 *   5. snapshot.status = 'extracted' 또는 'extract_failed'
 *
 * 에러 정책: VLM 호출 실패해도 snapshot 자체는 그대로 (재시도 가능).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // Claude Vision 호출에 ~10-30초

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(
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

    // 1. snapshot
    const { data: snap } = await supabase
      .from("paper_ledger_snapshots")
      .select("id, store_uuid, business_date, sheet_kind, storage_path, status")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = snap as {
      id: string; store_uuid: string; business_date: string;
      sheet_kind: SheetKind; storage_path: string; status: string
    }
    if (s.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 2. 매장별 dictionary
    const { data: fmtRow } = await supabase
      .from("store_paper_format")
      .select("symbol_dictionary, known_stores")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    const fmt = fmtRow as {
      symbol_dictionary?: Record<string, unknown>
      known_stores?: string[]
    } | null

    // 3. status=extracting 표시
    await supabase
      .from("paper_ledger_snapshots")
      .update({ status: "extracting", updated_at: new Date().toISOString() })
      .eq("id", id)

    // 4. 이미지 다운로드
    const dl = await downloadPaperLedger(supabase, s.storage_path)
    if (!dl.ok) {
      await supabase
        .from("paper_ledger_snapshots")
        .update({ status: "extract_failed", updated_at: new Date().toISOString() })
        .eq("id", id)
      return NextResponse.json(
        { error: "STORAGE_DOWNLOAD_FAILED", message: dl.reason },
        { status: 500 },
      )
    }

    // 5. VLM
    const result = await extractFromImage({
      image_bytes: dl.bytes,
      mime_type: dl.mime_type,
      sheet_kind: s.sheet_kind,
      business_date: s.business_date,
      store_symbol_dictionary: fmt?.symbol_dictionary,
      store_known_stores: fmt?.known_stores,
    })

    if (!result.ok) {
      await supabase
        .from("paper_ledger_snapshots")
        .update({ status: "extract_failed", updated_at: new Date().toISOString() })
        .eq("id", id)
      return NextResponse.json(
        {
          error: result.reason.toUpperCase(),
          message: result.message,
          duration_ms: result.duration_ms,
        },
        { status: result.reason === "no_api_key" ? 503 : 500 },
      )
    }

    // 6. 결과 저장
    const { data: ext, error: insErr } = await supabase
      .from("paper_ledger_extractions")
      .insert({
        snapshot_id: id,
        extracted_json: result.extraction,
        vlm_model: result.vlm_model,
        prompt_version: result.prompt_version,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
        unknown_tokens: result.extraction.unknown_tokens ?? [],
      })
      .select("id")
      .single()
    if (insErr) {
      return NextResponse.json({ error: "DB_INSERT_FAILED", message: insErr.message }, { status: 500 })
    }

    await supabase
      .from("paper_ledger_snapshots")
      .update({ status: "extracted", updated_at: new Date().toISOString() })
      .eq("id", id)

    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_extracted",
      entity_table: "paper_ledger_snapshots",
      entity_id: id,
      status: "success",
      metadata: {
        extraction_id: (ext as { id: string }).id,
        duration_ms: result.duration_ms,
        cost_usd: result.cost_usd,
        unknown_count: result.extraction.unknown_tokens?.length ?? 0,
      },
    })

    return NextResponse.json({
      extraction_id: (ext as { id: string }).id,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
      unknown_tokens: result.extraction.unknown_tokens ?? [],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
