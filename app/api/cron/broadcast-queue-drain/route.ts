/**
 * Sprint 2 (2026-07-29): broadcast_queue worker
 *
 * POST /api/cron/broadcast-queue-drain
 *   Cron 전용 · CRON_SECRET header 검증
 *   10초 주기 권장 (GitHub Actions 는 5분 min → 5분마다 여러 번 drain)
 *
 *   pending queue 조회 · rate limit 체크 · 개별 or 배치 발행.
 *
 * R-cron-auth-hardening (2026-08-24):
 *   - `?secret=` query string 인증 제거 (access log 유출 위험 · Referer 유출)
 *   - `x-cron-secret` header 사용 · timing-safe 비교
 *   - `export const GET = POST` 제거 (query-string secret path 이 GET 으로도 노출됐음)
 */
import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { drainBroadcastQueue } from "@/lib/chat/broadcastQueue"

function verifyCronSecret(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const a = Buffer.from(header, "utf8")
  const b = Buffer.from(secret, "utf8")
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

export async function POST(request: Request) {
  const header = request.headers.get("x-cron-secret")
  if (!verifyCronSecret(header, process.env.CRON_SECRET)) {
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
