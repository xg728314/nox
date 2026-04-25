import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { verifyTotp } from "@/lib/security/totp"
import { decryptSecret } from "@/lib/security/crypto"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { regenerateBackupCodes } from "@/lib/security/backupCodes"

/**
 * R25: POST /api/auth/mfa/recovery-codes
 *
 * 백업 코드 전체 재발급. 기존 코드는 모두 폐기.
 *
 * 보호:
 *   - 로그인 + MFA 재인증 (현재 TOTP 코드 필수). 비밀번호로는 부족 —
 *     세션 탈취 시나리오에서 공격자가 새 코드 받아가는 걸 차단.
 *   - rate limit: 분당 5회 (정상 사용자는 거의 호출 안 함).
 *
 * 응답:
 *   { plain: ["XXXX-XXXX-XXXX", ...8개],
 *     warning: "이 코드는 1회만 표시됩니다." }
 *
 * 클라이언트 책임:
 *   - 표시 후 즉시 응답 객체 폐기 (state 에 남기지 않기).
 *   - 사용자에게 인쇄/PDF 저장 등 안내.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    // Burst guard.
    const rlLocal = rateLimit(`mfa-regen:${auth.user_id}`, { limit: 10, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many attempts." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } },
      )
    }
    const rl = await rateLimitDurable(supa(), {
      key: `mfa-regen:user:${auth.user_id}`,
      action: "mfa_recovery_codes_regen",
      limit: 5,
      windowSeconds: 60,
    })
    if (!rl.ok) {
      const status = rl.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many attempts." },
        { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } },
      )
    }

    const body = (await request.json().catch(() => ({}))) as { totp_code?: string }
    const code = typeof body.totp_code === "string" ? body.totp_code.trim() : ""
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "현재 TOTP 6자리 코드를 입력해주세요." },
        { status: 400 },
      )
    }

    const supabase = supa()

    // 현재 MFA 활성 + secret 로드.
    const { data: row } = await supabase
      .from("user_mfa_settings")
      .select("is_enabled, secret_iv, secret_ciphertext, secret_auth_tag")
      .eq("user_id", auth.user_id)
      .is("deleted_at", null)
      .maybeSingle()
    const rec = row as {
      is_enabled: boolean
      secret_iv: string | null
      secret_ciphertext: string | null
      secret_auth_tag: string | null
    } | null

    if (!rec?.is_enabled || !rec.secret_iv || !rec.secret_ciphertext || !rec.secret_auth_tag) {
      return NextResponse.json(
        { error: "MFA_NOT_ENABLED", message: "MFA 가 활성화돼야 백업 코드를 발급할 수 있습니다." },
        { status: 409 },
      )
    }

    // TOTP 재인증.
    let totpOk = false
    try {
      const secret = decryptSecret({
        iv: Buffer.from(rec.secret_iv, "base64"),
        ciphertext: Buffer.from(rec.secret_ciphertext, "base64"),
        auth_tag: Buffer.from(rec.secret_auth_tag, "base64"),
      })
      totpOk = verifyTotp(secret, code)
    } catch {
      totpOk = false
    }
    if (!totpOk) {
      await logAuditEvent(supabase, {
        auth,
        action: "mfa_recovery_codes_regen_failed",
        entity_table: "profiles",
        entity_id: auth.user_id,
        status: "denied",
        reason: "INVALID_TOTP",
      })
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 })
    }

    // 새 코드 발급 + 기존 폐기.
    const r = await regenerateBackupCodes(supabase, auth.user_id)
    if (!r.ok) {
      return NextResponse.json(
        { error: r.reason === "db_error" ? "DB_ERROR" : "MFA_NOT_SETUP" },
        { status: r.reason === "db_error" ? 500 : 409 },
      )
    }

    await logAuditEvent(supabase, {
      auth,
      action: "mfa_recovery_codes_regenerated",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
      metadata: { count: r.plain.length },
    })

    return NextResponse.json({
      plain: r.plain,
      warning:
        "이 코드는 지금 한 번만 표시됩니다. 안전한 곳에 저장하세요. 기존 백업 코드는 모두 폐기됐습니다.",
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
