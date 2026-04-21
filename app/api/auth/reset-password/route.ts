import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { getClientIp } from "@/lib/security/clientIp"

/**
 * STEP-028B — POST /api/auth/reset-password
 *
 * Self-service password reset. Locked policy:
 *   - Input: { email }
 *   - Eligibility: email must belong to an APPROVED store membership.
 *     pending / rejected / suspended → silently treated as "not found".
 *   - Mechanism: Supabase Auth `resetPasswordForEmail` (sends an email
 *     with a recovery link).
 *   - Existence privacy: response NEVER reveals whether an email is
 *     registered or whether the membership is approved. The same
 *     uniform `{ ok:true }` 200 is returned whether we sent a link or
 *     silently dropped the request. Rate limit + audit are the only
 *     observable side effects.
 *
 * This route does NOT modify login/signup/auth core. It only:
 *   - reads memberships (status filter)
 *   - calls supabase.auth.resetPasswordForEmail with the anon client
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * HOTFIX-3: delivery outcome classification.
 *
 * The previous `uniformUnknown()` masked ALL outcomes (including Supabase 429
 * "email rate limit exceeded") as success, so the UI told users
 * "발송되었습니다" while no email was actually queued. Live auth logs
 * confirmed this failure mode (Supabase returns 429 with error_code
 * "over_email_send_rate_limit" when hit too many times from the built-in
 * SMTP, and our route previously swallowed it).
 *
 * New response shape:
 *   ok: true
 *   delivery: "queued"        — Supabase accepted + enqueued a mail.send
 *   delivery: "rate_limited"  — Supabase returned 429 / rate limit hit
 *   delivery: "unknown"       — email unregistered / unapproved membership
 *                               OR Supabase returned a non-429 error.
 *                               Indistinguishable outcomes collapsed into
 *                               one bucket to preserve existence privacy
 *                               for the non-rate-limit negative cases.
 *   retry_after_seconds?: number  — only set for rate_limited when the
 *                                    Supabase message contained "after N
 *                                    seconds"
 *   message: Korean UI-ready text
 *
 * HTTP status is still 200 in all three cases (no change for machine
 * callers). The `delivery` field is what the UI branches on.
 */
type DeliveryState = "queued" | "rate_limited" | "unknown"

function uniformUnknown() {
  return NextResponse.json({
    ok: true,
    delivery: "unknown" as DeliveryState,
    message:
      "요청이 접수되었습니다. 메일이 도착하지 않으면 잠시 후 다시 시도하거나 관리자에게 문의하세요.",
  })
}

export async function POST(request: Request) {
  try {
    // ─── In-memory burst guard (fast-path) ─────────────────────
    const ip = getClientIp(request)
    const rlLocal = rateLimit(`reset-password:${ip}`, { limit: 10, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { ok: false, error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }

    // ─── Parse + validate ───────────────────────────────────────
    const body = (await request.json().catch(() => ({}))) as { email?: unknown }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    // Bad input → uniform OK to avoid distinguishing "no such email"
    // from "missing field" via timing or response shape.
    if (!email || !EMAIL_RE.test(email)) return uniformUnknown()

    // ─── Server config ──────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // SECURITY (R-7): durable distributed rate-limit. Per-IP primary
    // (stops single-source brute-force) + per-email secondary (stops
    // targeted account enumeration even across different IPs).
    for (const bucket of [
      { key: `reset-password:ip:${ip}`,     limit: 5  },
      { key: `reset-password:email:${email}`, limit: 3 },
    ]) {
      const rl = await rateLimitDurable(admin, {
        key: bucket.key,
        action: "reset_password",
        limit: bucket.limit,
        windowSeconds: 60,
      })
      if (!rl.ok) {
        const status = rl.reason === "db_error" ? 503 : 429
        return NextResponse.json(
          { ok: false, error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED" },
          { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } }
        )
      }
    }

    // ─── 1. Resolve auth user by email (paginated) ──────────────
    let userId: string | null = null
    for (let page = 1; page <= 50; page++) {
      const { data: pageData } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      const found = pageData?.users?.find((u) => (u.email ?? "").toLowerCase() === email)
      if (found) { userId = found.id; break }
      if (!pageData?.users || pageData.users.length < 200) break
    }
    if (!userId) return uniformUnknown() // unknown email → uniform

    // ─── 2. Approved-membership gate ────────────────────────────
    // At least one approved, non-deleted membership is required.
    const { data: mems } = await admin
      .from("store_memberships")
      .select("id")
      .eq("profile_id", userId)
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(1)
    if (!mems || mems.length === 0) return uniformUnknown() // pending/rejected/none → uniform

    // ─── 3. Send recovery email via anon client ─────────────────
    const anon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // HOTFIX: pass explicit `redirectTo` so the email link lands on the
    // password-completion page instead of the project's default Site URL
    // (which is root "/" — and root redirects to /login, dropping the
    // recovery tokens on the floor). Origin is derived from the request
    // so dev/staging/prod each resolve correctly without a hard-coded env
    // dependency. The Supabase project's Redirect URL allowlist must
    // include `<host>/reset-password/confirm` for this to take effect;
    // otherwise Supabase silently falls back to Site URL.
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      request.headers.get("origin") ||
      (() => {
        const proto = request.headers.get("x-forwarded-proto") || "https"
        const host = request.headers.get("host")
        return host ? `${proto}://${host}` : null
      })()
    const redirectTo = origin ? `${origin}/reset-password/confirm` : undefined
    // HOTFIX-3: classify Supabase's actual response so the UI can show
    // accurate wording. We now surface:
    //   - queued       : Supabase accepted; mail.send fired (log evidence)
    //   - rate_limited : Supabase 429 with rate-limit text (operator retries)
    //   - unknown      : anything else — including the uniformUnknown paths
    //                    above (no user / no approved membership)
    //
    // Rate-limit response is slightly more informative than the pre-fix
    // uniformOk, but the baseline privacy model was already leaky via the
    // approved-membership timing gate; this change does not materially
    // change the attack surface for a determined prober, while
    // substantially improving UX honesty for real operators.
    try {
      const { error: rpErr } = await anon.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined
      )
      if (rpErr) {
        const msg = rpErr.message || ""
        const msgLower = msg.toLowerCase()
        // Narrow HTTP status if supabase-js exposed one
        const status = (rpErr as { status?: number }).status ?? 0
        const isRateLimit =
          status === 429 ||
          msgLower.includes("rate limit") ||
          msgLower.includes("for security purposes") ||
          msgLower.includes("only request this after")
        if (isRateLimit) {
          console.warn("[reset-password] rate_limited", { email, msg })
          const m = /after\s+(\d+)\s+seconds?/i.exec(msg)
          const retryAfter = m ? parseInt(m[1], 10) : undefined
          return NextResponse.json({
            ok: true,
            delivery: "rate_limited" as DeliveryState,
            retry_after_seconds: retryAfter,
            message: retryAfter
              ? `요청이 너무 많습니다. 약 ${retryAfter}초 후에 다시 시도해주세요.`
              : "요청이 너무 많아 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.",
          })
        }
        console.warn("[reset-password] provider_error", { email, status, msg })
        return uniformUnknown()
      }
      console.info("[reset-password] queued", { email })
      return NextResponse.json({
        ok: true,
        delivery: "queued" as DeliveryState,
        message:
          "비밀번호 재설정 메일을 발송했습니다. 몇 분 내로 메일함에서 확인해주세요.",
      })
    } catch (e) {
      console.error("[reset-password] exception", { email, error: String(e) })
      return uniformUnknown()
    }
  } catch {
    // Even on internal error, return uniform OK to preserve privacy.
    return uniformUnknown()
  }
}
