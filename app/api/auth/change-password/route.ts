import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { invalidateAuthCacheByUserId } from "@/lib/auth/authCache"

/**
 * POST /api/auth/change-password
 *
 * Authenticated (cookie) password change. Primary use-case:
 *   - Forced-change flow for invited users: after login with temp
 *     password, middleware redirects to `/reset-password?force=1`,
 *     the page submits the new password here, we flip
 *     `profiles.must_change_password = false`, and the middleware gate
 *     stops redirecting.
 *
 * Why a new endpoint (not /api/auth/reset-password):
 *   - `/api/auth/reset-password` sends a recovery email (anon-client
 *     flow, cookie-less). It does NOT take a password argument and
 *     does NOT update profiles.
 *   - This endpoint is cookie-authenticated, uses the service-role
 *     admin API to update the password directly, and synchronously
 *     clears the must_change_password flag.
 *
 * Security:
 *   - resolveAuthContext required (cookie). Unauthenticated → 401.
 *   - New password policy: min 8 chars (stricter than signup's 6 so
 *     the forced-change actually replaces the temp with something
 *     non-trivial). Upper/lower/digit complexity optional — enforced
 *     at the UI for now; server only enforces length.
 *   - Supabase admin.auth.admin.updateUserById() bypasses client-side
 *     session state entirely — safe for server route.
 *   - After success:
 *       * profiles.must_change_password ← false
 *       * authCache is stale for ≤ 60 s; to close that window we do
 *         NOT try to mutate the cache from here (cross-process; would
 *         be best-effort). The caller's next request after the cache
 *         expires will see the fresh DB value. For immediate effect
 *         the UI should signOut + re-login; middleware's fail-open
 *         behaviour ensures no lockout in the interim.
 */

const MIN_PASSWORD_LEN = 8

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  // ── Parse + validate body ────────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as {
    new_password?: unknown
  }
  const newPassword = typeof body.new_password === "string" ? body.new_password : ""

  if (!newPassword) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", message: "새 비밀번호를 입력하세요." },
      { status: 400 },
    )
  }
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      {
        error: "PASSWORD_TOO_SHORT",
        message: `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다.`,
      },
      { status: 400 },
    )
  }

  // ── Perform the password update via admin API ────────────────
  let admin
  try {
    admin = getServiceClient()
  } catch {
    return NextResponse.json(
      { error: "SERVER_CONFIG_ERROR" },
      { status: 500 },
    )
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(
    auth.user_id,
    { password: newPassword },
  )
  if (updateErr) {
    const msg = (updateErr.message || "").toLowerCase()
    // Supabase's own password-policy rejections surface as various error
    // strings. Map the common ones to 400 for actionable UI; everything
    // else as 500.
    if (/weak|short|password|policy/i.test(msg)) {
      return NextResponse.json(
        {
          error: "PASSWORD_REJECTED",
          message: "비밀번호가 정책에 맞지 않습니다. 더 강한 비밀번호를 입력하세요.",
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: "PASSWORD_UPDATE_FAILED",
        message: "비밀번호 변경에 실패했습니다.",
      },
      { status: 500 },
    )
  }

  // ── Clear the forced-change gate ─────────────────────────────
  //    Idempotent; safe even if the flag was already false.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", auth.user_id)
  if (profileErr) {
    // The password was changed successfully; we just failed to clear
    // the gate. The user would be re-redirected on next navigation.
    // Surface as 500 so the UI can retry or instruct the user to
    // re-login, at which point resolveAuthContext will read a fresh
    // value once the authCache entry expires (≤ 60 s).
    return NextResponse.json(
      {
        error: "FLAG_CLEAR_FAILED",
        message:
          "비밀번호는 변경되었으나 상태 갱신에 실패했습니다. 잠시 후 재시도하세요.",
      },
      { status: 500 },
    )
  }

  // ROUND-CLEANUP-002: authCache 에서 이 user 의 모든 토큰 엔트리 제거.
  //   다음 request 에서 새 must_change_password=false 값을 즉시 읽도록.
  invalidateAuthCacheByUserId(auth.user_id)

  // ── Audit ────────────────────────────────────────────────────
  try {
    await logAuditEvent(admin, {
      auth,
      action: "password_changed",
      entity_table: "profiles",
      entity_id: auth.user_id,
      metadata: {
        via: "forced_change_or_self",
        source: "change_password_endpoint",
      },
    })
  } catch {
    // Best-effort; never blocks success.
  }

  return NextResponse.json({
    ok: true,
    message: "비밀번호가 변경되었습니다.",
  })
}
