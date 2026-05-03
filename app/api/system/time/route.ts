import { NextResponse } from "next/server"

/**
 * GET /api/system/time
 *
 * R-Counter-Clock (2026-04-30): 서버 시각 단일 진실원.
 *
 * 운영자 의도:
 *   "카운터 PC 시계가 매장마다 어긋나서 UI 의 경과시간 / 남은시간이 잘못
 *    표시된다. 손님 컴플레인 / 연장 누락 사고 원인."
 *
 * 정책:
 *   - 정산 금액 계산 자체는 server-side (calculateSettlementTotals)가
 *     participant.price_amount 를 합산하므로 **client clock 어긋남이 금액에
 *     영향 X**. 위험은 UI 표시(elapsed / 남은시간)뿐.
 *   - 본 API 가 server now 를 돌려주면 client 는 1회 fetch 후 offset 계산.
 *     `serverNow = Date.now() + offset` 로 client clock 보정.
 *
 * 가드: 인증 없음 (단순 시각 — 정보 누출 없음).
 * 캐시: 절대 금지 — 매번 신선한 값.
 *
 * 응답:
 *   { server_now: ISO, server_now_ms: epoch_ms, tz: "Asia/Seoul" }
 */

// 2026-05-03 R-Speed-x10: edge runtime — DB 호출 X, 순수 Date.now().
//   nodejs runtime cold start ~200ms, edge ~30ms. 클라이언트 offset 보정에 직결.
export const runtime = "edge"
export const dynamic = "force-dynamic"

export async function GET() {
  const now = Date.now()
  return NextResponse.json(
    {
      server_now: new Date(now).toISOString(),
      server_now_ms: now,
      tz: "Asia/Seoul",
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  )
}
