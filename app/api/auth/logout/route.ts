import { NextResponse } from "next/server"

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
 */
export async function POST() {
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
