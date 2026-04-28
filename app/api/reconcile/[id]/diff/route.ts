import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { computePaperTotals } from "@/lib/reconcile/paperTotals"
import { aggregateDbForDay } from "@/lib/reconcile/dbAggregate"
import { computeReconcile } from "@/lib/reconcile/match"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { resolveFeatureAccess, RECONCILE_ROLE_DEFAULTS } from "@/lib/auth/featureAccess"
import type { PaperExtraction } from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/[id]/diff
 *
 * R29: 최신 extraction 과 그날 DB 를 비교 → paper_ledger_diffs 신규 row.
 *
 * 호출 시점: extraction 완료 후. 다시 호출하면 새 row (이력 보관).
 *
 * 권한: owner / manager. 매장 스코프 강제.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

    const supabase = supa()

    // 1. snapshot
    const { data: snap } = await supabase
      .from("paper_ledger_snapshots")
      .select("id, store_uuid, business_date")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = snap as { id: string; store_uuid: string; business_date: string }
    if (s.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // R-Auth: business_date 별 view 권한 검증 (diff 는 read 작업)
    const access = await resolveFeatureAccess(supabase, auth, {
      table: "paper_ledger_access_grants",
      store_uuid: s.store_uuid,
      business_date: s.business_date,
      action: "view",
      role_defaults: RECONCILE_ROLE_DEFAULTS,
    })
    if (!access.allowed) {
      return NextResponse.json(
        { error: "ACCESS_DENIED", message: "이 날짜의 종이장부 비교 권한이 없습니다.", via: access.via },
        { status: 403 },
      )
    }

    // 2. 최신 extraction
    const { data: ext } = await supabase
      .from("paper_ledger_extractions")
      .select("id, extracted_json")
      .eq("snapshot_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!ext) {
      return NextResponse.json(
        { error: "NO_EXTRACTION", message: "먼저 추출(POST /extract) 을 실행하세요." },
        { status: 409 },
      )
    }
    const extraction = (ext as { id: string; extracted_json: PaperExtraction }).extracted_json
    const extraction_id = (ext as { id: string }).id

    // 3. paper totals
    const paper = computePaperTotals(extraction)

    // 4. DB aggregate
    const dbAgg = await aggregateDbForDay(supabase, s.store_uuid, s.business_date)

    // 5. reconcile
    const result = computeReconcile(paper, dbAgg)

    // 6. 저장
    const { data: diff, error: insErr } = await supabase
      .from("paper_ledger_diffs")
      .insert({
        snapshot_id: id,
        extraction_id,
        paper_owe_total_won: result.paper_owe_total_won,
        paper_recv_total_won: result.paper_recv_total_won,
        db_owe_total_won: result.db_owe_total_won,
        db_recv_total_won: result.db_recv_total_won,
        item_diffs: result.item_diffs,
        match_status: result.match_status,
      })
      .select("id")
      .single()
    if (insErr) {
      return NextResponse.json({ error: "DB_INSERT_FAILED", message: insErr.message }, { status: 500 })
    }

    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_diff_computed",
      entity_table: "paper_ledger_snapshots",
      entity_id: id,
      status: "success",
      metadata: {
        diff_id: (diff as { id: string }).id,
        match_status: result.match_status,
        item_count: result.item_diffs.length,
      },
    })

    return NextResponse.json({
      diff_id: (diff as { id: string }).id,
      ...result,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
