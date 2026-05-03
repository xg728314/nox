import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/auth/refresh
 *
 * HttpOnly cookie `nox_refresh_token` 으로 새 access_token 발급. 4시간 운영 정책
 * 안에서 access_token (Supabase 기본 1시간 TTL) 만료 시 자동 회복.
 *
 * 흐름:
 *   1. nox_refresh_token cookie 읽기. 없으면 401.
 *   2. supabase.auth.refreshSession({ refresh_token }) 호출. 실패 시 401 +
 *      cookie 정리 (재로그인 강제).
 *   3. 성공 시 새 access_token + refresh_token cookie 갱신.
 *
 * Same-origin 만 허용 (Origin / Referer 검사). 외부 스크립트 / curl 차단.
 *
 * 본 endpoint 자체는 access_token 검증을 하지 않는다 — 만료된 access_token 으로도
 * 호출 가능해야 회복 가능. refresh_token 자체가 인증 요소.
 */

export const dynamic = "force-dynamic"

// 2026-05-03: 4h → 5h. useIdleLogout DEFAULT_MS 와 통일.
const FOUR_HOURS_S = 5 * 60 * 60

function readCookie(cookieHeader: string, name: string): string {
  const prefix = `${name}=`
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim()
    if (trimmed.startsWith(prefix)) {
      const raw = trimmed.slice(prefix.length)
      try { return decodeURIComponent(raw).trim() } catch { return raw.trim() }
    }
  }
  return ""
}

function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")
  if (!host) return false
  const origin = request.headers.get("origin")
  if (origin) {
    try { if (new URL(origin).host === host) return true }
    catch { /* fall through */ }
  }
  const referer = request.headers.get("referer")
  if (referer) {
    try { if (new URL(referer).host === host) return true }
    catch { /* fall through */ }
  }
  return false
}

function clearCookies(res: NextResponse): NextResponse {
  res.cookies.set({
    name: "nox_access_token",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  })
  res.cookies.set({
    name: "nox_refresh_token",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  })
  return res
}

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: "ORIGIN_FORBIDDEN" }, { status: 403 })
  }

  const cookieHeader = request.headers.get("cookie") ?? ""
  const refreshToken = readCookie(cookieHeader, "nox_refresh_token")
  if (!refreshToken) {
    return NextResponse.json(
      { error: "REFRESH_TOKEN_MISSING", message: "재로그인이 필요합니다." },
      { status: 401 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // anon client — refreshSession 은 anon 으로 동작.
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session) {
    const res = NextResponse.json(
      { error: "REFRESH_FAILED", message: "세션 갱신 실패. 다시 로그인 해주세요." },
      { status: 401 },
    )
    return clearCookies(res)
  }

  const sessionExpires = typeof data.session.expires_in === "number"
    ? data.session.expires_in
    : 3600
  const res = NextResponse.json({
    access_token: data.session.access_token,
    expires_in: sessionExpires,
  })
  res.cookies.set({
    name: "nox_access_token",
    value: data.session.access_token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.min(FOUR_HOURS_S, sessionExpires),
  })
  if (data.session.refresh_token) {
    res.cookies.set({
      name: "nox_refresh_token",
      value: data.session.refresh_token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: FOUR_HOURS_S,
    })
  }
  return res
}
