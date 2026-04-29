import { NextResponse } from "next/server"

/**
 * GET /api/health
 *
 * R29 (2026-04-26): Cloud Run + HTTPS Load Balancer health check 용.
 *   인증 없이 항상 200. 외부 health check 가 / 로 가면 middleware 에 걸려
 *   302 redirect 되므로 별도 endpoint 필요.
 *
 * middleware.ts 의 matcher 에 /api/health 가 포함 안 됨 → 통과.
 *
 * Backend service health check 설정:
 *   Path: /api/health
 *   Interval: 10s
 *   Timeout: 5s
 *   Healthy threshold: 1
 *   Unhealthy threshold: 3
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "nox",
    timestamp: new Date().toISOString(),
  })
}
