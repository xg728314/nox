import { NextResponse } from "next/server"
import { rateLimit } from "@/lib/security/guards"

/**
 * GET /api/auth/realtime-token
 *
 * Returns the current session's Supabase JWT so the browser can open an
 * **authenticated** Supabase Realtime channel (required once RLS is enabled
 * on realtime-subscribed tables — room_sessions / session_participants /
 * orders — in a future round).
 *
 * ── Security tradeoff (XSS) ──────────────────────────────────────
 *   R-1 remediation 이 access_token 을 HttpOnly 쿠키에 가둔 이유는 XSS
 *   에서 토큰 탈취를 막기 위함. 본 엔드포인트는 그 보호막에 의도적
 *   구멍을 낸다 — realtime authed 구독을 JS 에서 열어야 하는 Supabase
 *   제약 때문. XSS 가 발생하면 이 엔드포인트를 호출해 토큰을 얻을
 *   수 있다. 따라서 본 엔드포인트는 **다음을 동시에 만족** 시켜야 한다:
 *     (a) GET 외 메서드 금지 — CSRF/side-effect 표면 축소.
 *     (b) Same-origin 만 허용 — Origin 헤더가 없거나 다른 호스트면 거부.
 *         CORS 미설정이라 크로스 오리진 fetch 는 브라우저가 기본 차단
 *         하지만, 서버 레벨에서 2중 방어.
 *     (c) Per-session rate limit — XSS 가 스크립트로 반복 호출하지 못하게.
 *     (d) 응답 필드 최소화 — access_token, expires_at 2개만.
 *     (e) Bearer fallback 비허용 — 쿠키 전용.
 *     (f) `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`,
 *         `Referrer-Policy: no-referrer`.
 *     (g) 만료된 토큰이면 401 — 만료 토큰이 잠시라도 네트워크를 타지 않음.
 *
 * ── 회피 가능한 위협 / 불가능한 위협 ─────────────────────────────
 *   ✅ CSRF: GET만 허용 + Origin 체크로 cross-site 호출 차단. 본 응답에
 *      부작용 없음 + JSON 이라 CSRF 영향 최소.
 *   ✅ 외부 스크립트/MCP 악용: Origin 검사로 차단 (Bearer fallback 없음).
 *   ⚠️ 동일 오리진 XSS: 완전 차단 불가. rate limit 으로 완화만 가능.
 *      근본 해결은 realtime-only short-lived token 도입 (향후 라운드).
 *
 * ── Caller 계약 ──────────────────────────────────────────────────
 *   useRooms realtime 용. exp - 60 s 시점에 재요청해 갱신. 401/403/429
 *   모두 구독 열지 않음 (fail-closed).
 */
export const dynamic = "force-dynamic"

const RATE_LIMIT_PER_MIN = 30 // realtime client 는 수 분당 1회가 정상. 여유치.

function readCookieToken(cookieHeader: string): string {
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim()
    if (trimmed.startsWith("nox_access_token=")) {
      const raw = trimmed.slice("nox_access_token=".length)
      try {
        return decodeURIComponent(raw).trim()
      } catch {
        return raw.trim()
      }
    }
  }
  return ""
}

function decodeExp(jwt: string): number | null {
  const parts = jwt.split(".")
  if (parts.length !== 3) return null
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const pad = payload.length % 4
    const padded = pad === 0 ? payload : payload + "=".repeat(4 - pad)
    const json = Buffer.from(padded, "base64").toString("utf8")
    const obj = JSON.parse(json) as { exp?: number }
    return typeof obj.exp === "number" ? obj.exp : null
  } catch {
    return null
  }
}

function hardenHeaders(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private")
  res.headers.set("X-Content-Type-Options", "nosniff")
  res.headers.set("Referrer-Policy", "no-referrer")
  return res
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  return hardenHeaders(NextResponse.json(body, { status }))
}

/**
 * Same-origin guard — Origin 또는 Referer 둘 중 하나가 host 와 일치하면 통과.
 *
 * 2026-04-25 fix: 이전 구현은 Origin 만 요구했는데, same-origin GET fetch 에서
 *   브라우저가 Origin 을 생략하는 케이스 (Safari, 일부 Chrome 버전, 개발
 *   프록시) 가 있어서 ORIGIN_FORBIDDEN 오발동. Referer fallback 추가로 정상
 *   브라우저 접근은 허용하되 curl/외부 스크립트(둘 다 없음) 는 여전히 차단.
 */
function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")
  if (!host) return false

  const origin = request.headers.get("origin")
  if (origin) {
    try {
      if (new URL(origin).host === host) return true
    } catch { /* malformed origin → fallback 시도 */ }
  }

  const referer = request.headers.get("referer")
  if (referer) {
    try {
      if (new URL(referer).host === host) return true
    } catch { /* malformed referer → 차단 */ }
  }

  return false
}

function methodNotAllowed(): NextResponse {
  const res = json(405, {
    error: "METHOD_NOT_ALLOWED",
    message: "Only GET is supported.",
  })
  res.headers.set("Allow", "GET")
  return res
}

export async function GET(request: Request) {
  // (b) Same-origin gate.
  if (!originAllowed(request)) {
    return json(403, { error: "ORIGIN_FORBIDDEN" })
  }

  const cookieHeader = request.headers.get("cookie") ?? ""
  const token = readCookieToken(cookieHeader)
  if (!token) {
    return json(401, { error: "AUTH_MISSING" })
  }

  // (c) Per-session rate limit. 토큰 꼬리 16 자를 키로 삼아 세션 단위 집계.
  //     값 자체는 토큰이 아닌 opaque suffix — 로그/메모리에 토큰 전체 남지 않음.
  const rlKey = `realtime-token:${token.slice(-16)}`
  const rl = rateLimit(rlKey, { limit: RATE_LIMIT_PER_MIN, windowMs: 60_000 })
  if (!rl.ok) {
    const res = json(429, { error: "RATE_LIMITED" })
    res.headers.set("Retry-After", String(Math.max(1, Math.ceil(rl.retryAfter / 1000))))
    return res
  }

  const exp = decodeExp(token)
  if (exp == null) {
    return json(401, { error: "AUTH_INVALID" })
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (exp <= nowSec) {
    return json(401, { error: "AUTH_EXPIRED" })
  }

  return json(200, {
    access_token: token,
    expires_at: exp, // epoch seconds
  })
}

// (a) 비-GET 명시적 차단. Next.js 는 정의 안 된 메서드를 405 로 돌려주지만,
//     명시 핸들러를 둬 응답 헤더(Cache-Control/Allow)를 통일.
export async function POST()    { return methodNotAllowed() }
export async function PUT()     { return methodNotAllowed() }
export async function PATCH()   { return methodNotAllowed() }
export async function DELETE()  { return methodNotAllowed() }
export async function OPTIONS() { return methodNotAllowed() }
export async function HEAD()    { return methodNotAllowed() }
