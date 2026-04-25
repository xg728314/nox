import { NextResponse } from "next/server"
import { invalidateAuthCache } from "@/lib/auth/authCache"

/**
 * STEP-002C: POST /api/auth/logout
 *
 * Clears the server-readable HttpOnly cookie `nox_access_token` that
 * STEP-002A set during login / MFA and that STEP-002B middleware
 * reads to gate protected pages. Without this, clearing localStorage
 * alone would leave the browser cookie-authenticated until natural
 * cookie expiry — middleware would keep admitting the user to
 * protected UI after "logout".
 *
 * Design constraints (STEP-002C):
 *   - Idempotent: safe to call multiple times or when no cookie exists.
 *   - No authentication required to clear the cookie.
 *   - Cookie-clear attributes mirror the STEP-002A `set` options exactly
 *     (name, path, sameSite, httpOnly, secure) with maxAge: 0 so the
 *     browser deletes the cookie across all matching paths.
 *   - Bearer / Authorization-header flow is untouched.
 *   - No logging, no token blacklist, no server-side session store.
 *
 * ROUND-CLEANUP-002:
 *   - Access token 이 쿠키에 있으면 `invalidateAuthCache(token)` 으로 warm
 *     인스턴스 캐시를 즉시 제거. 남은 TTL (≤15s) 을 기다리지 않고 revocation
 *     지연을 0 으로.
 */
export async function POST(request: Request) {
  // 쿠키에서 token 추출 (cookie 헤더만 읽음; body 불필요).
  const cookieHeader = request.headers.get("cookie") ?? ""
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nox_access_token="))
  if (match) {
    const raw = match.slice("nox_access_token=".length)
    let token = ""
    try { token = decodeURIComponent(raw).trim() } catch { token = raw.trim() }
    if (token) invalidateAuthCache(token)
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set({
    name: "nox_access_token",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  })
  return res
}
