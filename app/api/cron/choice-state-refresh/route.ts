/**
 * Sprint 2 (2026-07-29): 매장별 초이스 상태 주기적 refresh
 *
 * POST /api/cron/choice-state-refresh
 *   Cron 전용 · CRON_SECRET header 검증
 *   5분 주기 권장 (일반적 · 실시간성 필요하면 helper 를 직접 호출)
 *
 *   모든 활성 매장 (5-8F) 순회 · refreshStoreChoiceState 호출.
 *   상태 변경 감지된 것만 발행 (spam 방지).
 */
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { refreshStoreChoiceState } from "@/lib/chat/publishChoiceState"

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  try {
    const sb = getServiceClient()
    const { data: stores } = await sb
      .from("stores")
      .select("id")
      .is("deleted_at", null)
      .in("floor", [5, 6, 7, 8])
    const rows = (stores ?? []) as Array<{ id: string }>
    let changed = 0
    let skipped = 0
    const errors: string[] = []
    for (const s of rows) {
      const r = await refreshStoreChoiceState(s.id)
      if (r.changed) changed++
      else if (r.reason && r.reason !== "same_hash") errors.push(`${s.id.slice(0, 8)}: ${r.reason}`)
      else skipped++
    }
    return NextResponse.json({
      ok: true,
      total_stores: rows.length,
      changed,
      skipped_same_hash: skipped,
      errors,
    })
  } catch (e) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

export const GET = POST
