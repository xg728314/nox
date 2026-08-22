/**
 * Sprint 2 (2026-07-29): broadcast_queue worker
 *
 * POST /api/cron/broadcast-queue-drain
 *   Cron 전용 · CRON_SECRET header 검증
 *   10초 주기 권장 (GitHub Actions 는 5분 min → 5분마다 여러 번 drain)
 *
 *   pending queue 조회 · rate limit 체크 · 개별 or 배치 발행.
 */
import { NextResponse } from "next/server"
import { drainBroadcastQueue } from "@/lib/chat/broadcastQueue"

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  try {
    const result = await drainBroadcastQueue()
    return NextResponse.json({
      ok: true,
      processed_individual: result.processed,
      processed_batched: result.batched,
      errors: result.errors,
    })
  } catch (e) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

// GET 도 지원 (일부 cron 서비스는 GET only)
export const GET = POST
