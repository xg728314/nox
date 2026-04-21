import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { getClientIp } from "@/lib/security/clientIp"

/**
 * STEP-028A — POST /api/auth/find-id
 *
 * Self-service ID (email) recovery. Locked policy from the task file:
 *   - Inputs: store, full_name, phone
 *   - Output: masked email only (NEVER full email)
 *
 * Security stance:
 *   - Service-role client (server only). No anon access.
 *   - Three-factor match required: (store, full_name, normalized phone).
 *     Single-factor matches are not enough for production identity.
 *   - Account enumeration is mitigated by always returning the same
 *     uniform `{ ok:false }` shape on any non-unique result (0 matches,
 *     >1 matches, deleted/rejected memberships, missing auth user).
 *   - Pending and approved memberships are eligible. Rejected/suspended
 *     are treated as "not found" — they get the uniform response.
 *   - Per-IP rate limit (5/min) so the masking endpoint cannot be used
 *     as a phone-book scanner.
 *
 * This route does NOT modify auth/login/signup. It only reads.
 */

const PHONE_DIGIT_MIN = 9
const PHONE_DIGIT_MAX = 15

type FindIdBody = {
  store?: unknown
  full_name?: unknown
  phone?: unknown
}

function notFound() {
  // Uniform response — do not differentiate 0 vs >1 vs status-blocked.
  return NextResponse.json({ ok: false }, { status: 200 })
}

function maskEmail(email: string): string | null {
  const at = email.indexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const keep = local.length >= 2 ? 2 : 1
  const stars = Math.max(3, local.length - keep)
  return `${local.slice(0, keep)}${"*".repeat(stars)}@${domain}`
}

export async function POST(request: Request) {
  try {
    // ─── In-memory burst guard (fast-path) ─────────────────────
    const ip = getClientIp(request)
    const rlLocal = rateLimit(`find-id:${ip}`, { limit: 10, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { ok: false, error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }

    // ─── Parse + validate ───────────────────────────────────────
    const body = (await request.json().catch(() => ({}))) as FindIdBody
    const store = typeof body.store === "string" ? body.store.trim() : ""
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
    const phoneRaw = typeof body.phone === "string" ? body.phone : ""
    const phone = phoneRaw.replace(/\D/g, "")

    if (!store || !fullName || !phone) return notFound()
    if (phone.length < PHONE_DIGIT_MIN || phone.length > PHONE_DIGIT_MAX) return notFound()

    // ─── Server config ──────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // SECURITY (R-7): durable rate-limit so the masking endpoint
    // cannot be used as a distributed phone-book scanner. Per-IP
    // primary; per-(store,phone) secondary to throttle targeted
    // iterations even across IPs.
    for (const bucket of [
      { key: `find-id:ip:${ip}`,         limit: 5 },
      { key: `find-id:phone:${phone}`,   limit: 5 },
    ]) {
      const rl = await rateLimitDurable(admin, {
        key: bucket.key,
        action: "find_id",
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

    // ─── 1. Resolve store_uuid by store_name ────────────────────
    const { data: storeRow } = await admin
      .from("stores")
      .select("id, is_active")
      .eq("store_name", store)
      .is("deleted_at", null)
      .maybeSingle()
    if (!storeRow || storeRow.is_active === false) return notFound()
    const storeUuid = storeRow.id as string

    // ─── 2. Profiles matching (full_name, phone) ────────────────
    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .eq("full_name", fullName)
      .eq("phone", phone)
      .is("deleted_at", null)
    const profileIds = (profiles ?? []).map((p) => p.id as string)
    if (profileIds.length === 0) return notFound()

    // ─── 3. Intersect with eligible memberships at this store ───
    // Eligible = approved or pending. Rejected/suspended → not found.
    const { data: mems } = await admin
      .from("store_memberships")
      .select("profile_id")
      .in("profile_id", profileIds)
      .eq("store_uuid", storeUuid)
      .in("status", ["approved", "pending"])
      .is("deleted_at", null)
    const eligible = (mems ?? []).map((m) => m.profile_id as string)
    // Must be exactly one unique profile to avoid leaking that there
    // are duplicates with the same name+phone at the same store.
    const uniqueIds = Array.from(new Set(eligible))
    if (uniqueIds.length !== 1) return notFound()
    const targetProfileId = uniqueIds[0]

    // ─── 4. Fetch auth user email ───────────────────────────────
    const { data: userRes, error: getErr } = await admin.auth.admin.getUserById(targetProfileId)
    if (getErr || !userRes?.user?.email) return notFound()
    const masked = maskEmail(userRes.user.email)
    if (!masked) return notFound()

    return NextResponse.json({ ok: true, email_masked: masked })
  } catch {
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
