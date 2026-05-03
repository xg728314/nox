import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseFromText } from "@/lib/reconcile/parseText"
import { fillExtractionPayouts } from "@/lib/reconcile/computePayout"
import { validateExtraction } from "@/lib/reconcile/validateExtraction"
import {
  getLearnedCorrectionsByStore,
  formatLearnedCorrectionsForPrompt,
} from "@/lib/learn/getLearnedCorrections"
import type { SheetKind } from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/[id]/parse-text
 *
 * R-ParseText (2026-05-01):
 *   운영자가 자유 형식 텍스트로 종이장부를 적으면 Claude 가 PaperExtraction
 *   JSON 으로 변환. 셀별 클릭 부담 90% 감소.
 *
 * Body: { text: string }
 *
 * 응답:
 *   { extraction, model, prompt_version, duration_ms, cost_usd }
 *
 * 권한: snapshot 의 매장 owner / manager / waiter (reconcile 편집 가능자).
 *
 * 흐름 (저장은 별도 — 응답 받은 후 클라가 PUT /api/reconcile/[id]/edit 호출):
 *   1. snapshot 검증 + 매장 scope.
 *   2. 매장 known_stores / known_hostesses / learned_corrections fetch.
 *   3. parseFromText 호출 (Claude text-only).
 *   4. JSON 응답 → 클라가 검수 후 edit 저장.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_TEXT_LEN = 8000

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
    if (auth.role !== "owner" && auth.role !== "manager" && auth.role !== "waiter") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "owner / manager / waiter 만 가능합니다." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as { text?: string }
    const text = typeof body.text === "string" ? body.text.trim() : ""
    if (text.length < 5) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "텍스트가 너무 짧습니다." },
        { status: 400 },
      )
    }
    if (text.length > MAX_TEXT_LEN) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `텍스트가 너무 깁니다 (max ${MAX_TEXT_LEN}자).` },
        { status: 400 },
      )
    }

    const supabase = supa()

    // snapshot 검증
    const { data: snap } = await supabase
      .from("paper_ledger_snapshots")
      .select("id, store_uuid, sheet_kind, business_date")
      .eq("id", id)
      .maybeSingle()
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = snap as {
      id: string
      store_uuid: string
      sheet_kind: SheetKind
      business_date: string
    }
    if (s.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 매장 컨텍스트 fetch (병렬)
    const [fmtRes, hostessRes, learned] = await Promise.all([
      supabase
        .from("store_paper_format")
        .select("known_stores")
        .eq("store_uuid", auth.store_uuid)
        .maybeSingle(),
      supabase
        .from("hostesses")
        .select("name, stage_name")
        .eq("store_uuid", auth.store_uuid)
        .eq("is_active", true)
        .is("deleted_at", null)
        .limit(200),
      getLearnedCorrectionsByStore(supabase, auth.store_uuid, {
        types: [
          "reconcile.staff.session.store",
          "reconcile.staff.session.time_tier",
          "reconcile.staff.session.service_type",
          "reconcile.rooms.staff.origin_store",
          "reconcile.rooms.staff.service_type",
          "reconcile.rooms.staff.time_tier",
        ],
        limit_per_type: 10,
      }),
    ])

    const fmt = fmtRes.data as { known_stores?: string[] } | null
    const hostessRows = (hostessRes.data ?? []) as Array<{
      name: string | null
      stage_name: string | null
    }>
    const knownHostesses = Array.from(
      new Set(
        hostessRows
          .map((h) => (h.stage_name ?? h.name ?? "").trim())
          .filter((n) => n.length > 0 && n.length <= 5),
      ),
    )
    const learnedBlock = formatLearnedCorrectionsForPrompt(learned)

    const result = await parseFromText({
      text,
      sheet_kind: s.sheet_kind,
      business_date: s.business_date,
      store_known_stores: fmt?.known_stores,
      store_known_hostesses: knownHostesses,
      store_learned_corrections_block: learnedBlock,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason.toUpperCase(),
          message: result.message,
          duration_ms: result.duration_ms,
          raw_response_text: result.raw_response_text,
        },
        { status: result.reason === "no_api_key" ? 500 : 400 },
      )
    }

    // R-AutoPrice (2026-05-01): 운영자가 금액을 안 적었을 때 origin_store
    //   단가표 lookup 으로 hostess_payout_won 자동 환산.
    //   "1개반/2개반/3개반" → 정식 × N + 반티. 매장별 store_service_types 사용.
    try {
      await fillExtractionPayouts(supabase, result.extraction)
    } catch (e) {
      console.warn("[parse-text] fillExtractionPayouts failed:", e instanceof Error ? e.message : e)
    }

    // R-AutoPrice (2026-05-01): 종이 적은 합계 vs 자동 환산 비교 + 실장수익.
    //   계좌 vs (양주+스태프+팁), 줄돈 박스 vs staff_entries 합계.
    //   차이 > 1천원이면 warnings 에 한국어 메시지로 표시.
    const validation = validateExtraction(result.extraction)

    return NextResponse.json({
      extraction: result.extraction,
      validation,
      model: result.model,
      prompt_version: result.prompt_version,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
