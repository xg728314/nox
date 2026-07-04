/**
 * GET /api/ai/summary
 *
 * Claude 로 오늘 매장 상황 요약. 3~5줄.
 *   - 데이터 수집: 매출/타임/일하는중/임박/이상감지
 *   - Claude Sonnet 에 짧은 요약 요청
 *
 * 권한: owner / manager.
 * env: ANTHROPIC_API_KEY 필요. 없으면 fallback (템플릿 요약).
 *
 * R-ai-summary (2026-06-28).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import Anthropic from "@anthropic-ai/sdk"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()

    // 1. 데이터 수집 — 오늘 영업일
    const today = getBusinessDateForOps()
    const start = new Date(`${today}T06:00:00+09:00`)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)

    const { data: parts } = await supabase
      .from("session_participants")
      .select(
        "membership_id, category, price_amount, hostess_payout_amount, status, entered_at, time_minutes, origin_store_uuid, store_uuid",
      )
      .eq("store_uuid", auth.store_uuid)
      .gte("entered_at", start.toISOString())
      .lt("entered_at", end.toISOString())
      .is("deleted_at", null)

    type P = {
      membership_id: string
      category: string | null
      price_amount: number | null
      hostess_payout_amount: number | null
      status: string
      entered_at: string
      time_minutes: number | null
      origin_store_uuid: string | null
      store_uuid: string
    }
    const rows = (parts ?? []) as P[]
    const active = rows.filter((p) => p.status === "active")
    const finished = rows.filter((p) => p.status === "left")
    const now = Date.now()
    const imminent = active.filter((p) => {
      if (!p.time_minutes) return false
      const endMs = new Date(p.entered_at).getTime() + p.time_minutes * 60_000
      const remain = Math.floor((endMs - now) / 60_000)
      return remain > 0 && remain <= 10
    })
    const totalGross = rows.reduce((a, p) => a + Number(p.price_amount ?? 0), 0)
    const totalPayout = rows.reduce(
      (a, p) => a + Number(p.hostess_payout_amount ?? 0),
      0,
    )
    const external = rows.filter(
      (p) => p.origin_store_uuid && p.origin_store_uuid !== auth.store_uuid,
    )
    const uniqueHostess = new Set(rows.map((p) => p.membership_id)).size

    const catCount: Record<string, number> = {}
    for (const p of rows) {
      const c = p.category ?? "?"
      catCount[c] = (catCount[c] ?? 0) + 1
    }

    const stats = {
      date: today,
      total_gross_manwon: Math.round(totalGross / 10000),
      total_hostess_payout_manwon: Math.round(totalPayout / 10000),
      manager_profit_manwon: Math.round((totalGross - totalPayout) / 10000),
      total_participations: rows.length,
      active_now: active.length,
      finished: finished.length,
      imminent_count: imminent.length,
      unique_hostess: uniqueHostess,
      external_incoming: external.length,
      by_category: catCount,
    }

    // 2. Claude 요청 (API key 있으면), 없으면 템플릿 요약
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      // Fallback — 간단 템플릿
      const lines = [
        `오늘(${today}) 총 매출 ${stats.total_gross_manwon}만원, 실장 순수익 ${stats.manager_profit_manwon}만원.`,
        `${stats.total_participations}건 참여 (${stats.unique_hostess}명 · ${stats.finished}건 완료 · ${stats.active_now}건 진행 중).`,
        stats.imminent_count > 0
          ? `⏰ ${stats.imminent_count}건 10분 임박.`
          : `임박 세션 없음.`,
        stats.external_incoming > 0
          ? `외부 식구 ${stats.external_incoming}건 우리 매장 방문.`
          : "",
      ].filter(Boolean)
      return NextResponse.json({
        summary: lines.join(" "),
        source: "template",
        stats,
      })
    }

    const client = new Anthropic({ apiKey })
    const prompt = `너는 한국 유흥업소 (호스티스 클럽) 매장 실장 어시스턴트야. 아래 오늘 매장 데이터를 보고 실장에게 3~5줄로 짧고 명확하게 요약해줘. 중요 순서: 매출 → 진행/완료 상태 → 임박/이상 → 외부 식구. 반말 X, 이모지 살짝 OK. 만원 단위.

데이터:
${JSON.stringify(stats, null, 2)}`

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    })
    const first = msg.content[0]
    const summaryText =
      first && first.type === "text" ? first.text.trim() : "요약 생성 실패"

    return NextResponse.json({
      summary: summaryText,
      source: "claude",
      stats,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}
