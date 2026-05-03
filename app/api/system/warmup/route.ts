import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/system/warmup — cold-start warmup endpoint.
 *
 * 2026-05-03 R-Cold-Warmup:
 *   Vercel serverless 인스턴스는 트래픽 없으면 freeze → 첫 요청에서 cold start
 *   (~500ms ~ 2s 추가 지연 + DB connection 새로 맺음). 카운터/카페 운영 중 첫
 *   요청 사용자가 4초+ 기다리는 사례 다수.
 *
 *   해결책 두 가지 layer:
 *     1) 이 endpoint 가 "값싼 DB ping" 으로 connection pool warm + 모듈 import
 *        warm 만 시킨다. 응답은 즉시 OK.
 *     2) 외부 uptime monitor (Better Uptime / UptimeRobot 등) 이 1분 간격으로
 *        본 endpoint 를 GET → instance 가 trial 30s freeze timeout 안에 다음
 *        ping 받아서 평생 warm.
 *
 * 보안:
 *   - 인증 없음 (warmup 은 누구나 호출 가능해야 의미). 응답 페이로드는 1줄.
 *   - rate-limit 없음 (외부 monitor 가 분당 1~12회 호출 예상).
 *   - 데이터 노출 없음. 단순 connection ping + 시간만 반환.
 *
 * 비용:
 *   - DB query 1회 ("SELECT 1" 대용으로 stores LIMIT 1).
 *   - 일 14400 회 (10초 간격 monitor) × 1 RTT ≈ 0 비용.
 *
 * 사용:
 *   GET https://nox.example.com/api/system/warmup
 *   { "ok": true, "warm_at": "2026-05-03T12:34:56.789Z", "rtt_ms": 12 }
 *
 * Vercel Hobby 한계: cron 1일 1회 제한 → cron 으로는 못 함.
 *   외부 monitor 등록이 정석. (Vercel 기본 monitoring 도 있고, free 도구도 다수)
 */

// 2026-05-03 R-Speed-x10: edge runtime — V8 engine, 콜드 시작 ~30ms (Node.js 200-500ms 대비).
//   Supabase 는 fetch 기반이라 edge 호환. nodejs 전용 모듈 의존 없음.
export const runtime = "edge"
export const dynamic = "force-dynamic"
export const revalidate = 0

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  const t0 = Date.now()
  const supabase = supa()
  if (!supabase) {
    // env 미설정도 200 으로 — uptime monitor 가 false alarm 안 내도록.
    return NextResponse.json({
      ok: true,
      warm_at: new Date().toISOString(),
      env_ok: false,
      note: "supabase env not configured",
    })
  }

  try {
    // 가장 가벼운 query — 단일 row + 1 컬럼 + LIMIT 1.
    //   stores 는 작은 테이블 + 자주 캐시되어 있어 ms 단위 응답.
    await supabase.from("stores").select("id").limit(1)
    const rttMs = Date.now() - t0
    return NextResponse.json({
      ok: true,
      warm_at: new Date().toISOString(),
      rtt_ms: rttMs,
      env_ok: true,
    })
  } catch (e) {
    // DB 일시 장애여도 instance 자체는 warm 됨 → 200 으로.
    return NextResponse.json({
      ok: true,
      warm_at: new Date().toISOString(),
      env_ok: false,
      note: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    })
  }
}
