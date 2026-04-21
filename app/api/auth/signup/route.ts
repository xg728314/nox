import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { getClientIp } from "@/lib/security/clientIp"

/**
 * STEP-025B — POST /api/auth/signup
 *
 * Hostess-only, approval-gated signup. Producer for the existing
 * approvals consumer (app/api/store/approvals/route.ts).
 *
 * Flow:
 *   1. Validate inputs (six locked fields).
 *   2. Resolve the selected store_name → store_uuid (active stores only).
 *   3. Pre-check duplicates at the application layer:
 *        a. email already exists in auth.users → EMAIL_TAKEN
 *        b. (phone, store) already has a non-rejected hostess membership
 *           with status pending or approved → ALREADY_REGISTERED_AT_STORE
 *      No new DB constraints; this is the substitute the design lock
 *      (STEP-025) called for.
 *   4. Create the auth user via service-role admin API. This mirrors
 *      scripts/seed-test-data.ts — there is no anon-client signUp path
 *      in this codebase, and this route runs server-side only.
 *   5. Upsert the profile (full_name / nickname / phone).
 *   6. Insert one store_memberships row:
 *        role='hostess', status='pending', is_primary=true,
 *        approved_by=null, approved_at=null
 *   7. Return { ok:true, status:'pending', message:... }.
 *
 * Rules respected:
 *   - role is hard-coded to 'hostess'. Body cannot override it.
 *   - login route is NOT modified. The existing 401 MEMBERSHIP_NOT_APPROVED
 *     gate handles the pending state for free.
 *   - approvals route is NOT modified. The pending row this endpoint
 *     creates is exactly what that endpoint already lists.
 *   - No migration. No schema change.
 */

const PHONE_DIGIT_MIN = 9
const PHONE_DIGIT_MAX = 15
const PASSWORD_MIN = 6
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SignupBody = {
  store?: unknown
  full_name?: unknown
  nickname?: unknown
  phone?: unknown
  email?: unknown
  password?: unknown
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SignupBody

    // ─── 1. Validate ────────────────────────────────────────────
    const store = typeof body.store === "string" ? body.store.trim() : ""
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : ""
    const phoneRaw = typeof body.phone === "string" ? body.phone : ""
    const phone = phoneRaw.replace(/\D/g, "")
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""

    if (!store) return bad("MISSING_FIELDS", "소속 매장을 선택하세요.")
    if (!fullName) return bad("MISSING_FIELDS", "이름을 입력하세요.")
    if (!nickname) return bad("MISSING_FIELDS", "닉네임을 입력하세요.")
    if (!phone) return bad("MISSING_FIELDS", "전화번호를 입력하세요.")
    if (phone.length < PHONE_DIGIT_MIN || phone.length > PHONE_DIGIT_MAX)
      return bad("PHONE_INVALID", "전화번호 형식을 확인하세요.")
    if (!email) return bad("MISSING_FIELDS", "이메일을 입력하세요.")
    if (!EMAIL_RE.test(email))
      return bad("EMAIL_INVALID", "이메일 형식이 올바르지 않습니다.")
    if (!password) return bad("MISSING_FIELDS", "비밀번호를 입력하세요.")
    if (password.length < PASSWORD_MIN)
      return bad("PASSWORD_TOO_SHORT", `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`)

    // ─── Fast-path in-memory burst guard ─────────────────────────
    // Absorbs rapid-fire requests within a single Node process before
    // we touch the DB. Not authoritative in multi-instance deploys —
    // the durable check below is.
    const rlLocal = rateLimit(`signup:${email}`, { limit: 10, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }

    // ─── Server config ─────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return bad("SERVER_CONFIG_ERROR", "서버 설정 오류.", 500)
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ─── Durable rate limit (distributed, DB-backed) ─────────────
    // SECURITY (R-7): primary rate-limit enforcement. Keys by both
    // email and IP so an attacker cannot rotate one to bypass.
    const ip = getClientIp(request)
    const rlEmail = await rateLimitDurable(admin, {
      key: `signup:email:${email}`,
      action: "signup",
      limit: 5,
      windowSeconds: 60,
    })
    if (!rlEmail.ok) {
      const status = rlEmail.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rlEmail.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "잠시 후 다시 시도하세요." },
        { status, headers: { "Retry-After": String(Math.max(1, rlEmail.retryAfter)) } }
      )
    }
    const rlIp = await rateLimitDurable(admin, {
      key: `signup:ip:${ip}`,
      action: "signup",
      limit: 10,
      windowSeconds: 60,
    })
    if (!rlIp.ok) {
      const status = rlIp.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rlIp.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "잠시 후 다시 시도하세요." },
        { status, headers: { "Retry-After": String(Math.max(1, rlIp.retryAfter)) } }
      )
    }

    // ─── 2. Store lookup ───────────────────────────────────────
    const { data: storeRow, error: storeErr } = await admin
      .from("stores")
      .select("id, store_name, is_active")
      .eq("store_name", store)
      .is("deleted_at", null)
      .maybeSingle()
    if (storeErr) {
      return bad("INTERNAL_ERROR", "매장 조회에 실패했습니다.", 500)
    }
    if (!storeRow || storeRow.is_active === false) {
      return bad("STORE_INVALID", "선택한 매장이 존재하지 않거나 비활성 상태입니다.")
    }
    const storeUuid = storeRow.id as string

    // ─── 3a. Duplicate check: email already in auth.users ──────
    // listUsers() is paginated; we accept the small cost here because
    // signup is a low-frequency operation and there is no admin
    // get-by-email endpoint in supabase-js v2.
    const { data: existingUsers, error: listErr } =
      await admin.auth.admin.listUsers()
    if (listErr) {
      return bad("INTERNAL_ERROR", "사용자 조회에 실패했습니다.", 500)
    }
    const existingByEmail = existingUsers?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === email
    )
    if (existingByEmail) {
      return NextResponse.json(
        { error: "EMAIL_TAKEN", message: "이미 가입된 이메일입니다." },
        { status: 409 }
      )
    }

    // ─── 3b. Duplicate check: same phone already pending/approved
    //          as a hostess at the same store ────────────────────
    // Join via profiles → store_memberships. We pre-resolve profile
    // ids whose phone matches, then look for any non-rejected
    // hostess membership at the target store.
    const { data: phoneProfiles, error: pErr } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .is("deleted_at", null)
    if (pErr) {
      return bad("INTERNAL_ERROR", "프로필 조회에 실패했습니다.", 500)
    }
    const phoneProfileIds = (phoneProfiles ?? []).map((p) => p.id as string)
    if (phoneProfileIds.length > 0) {
      const { data: dupMems, error: dupErr } = await admin
        .from("store_memberships")
        .select("id, status")
        .in("profile_id", phoneProfileIds)
        .eq("store_uuid", storeUuid)
        .eq("role", "hostess")
        .in("status", ["pending", "approved"])
        .is("deleted_at", null)
        .limit(1)
      if (dupErr) {
        return bad("INTERNAL_ERROR", "중복 신청 확인에 실패했습니다.", 500)
      }
      if (dupMems && dupMems.length > 0) {
        return NextResponse.json(
          {
            error: "ALREADY_REGISTERED_AT_STORE",
            message: "해당 매장에 이미 신청 또는 승인된 계정이 있습니다.",
          },
          { status: 409 }
        )
      }
    }

    // ─── 4. Create auth user (service-role admin API) ──────────
    // Mirrors scripts/seed-test-data.ts. email_confirm:true so the
    // user does not need to click an email link before the operator
    // can act on the pending row — the human gate is approval, not
    // mailbox access.
    const { data: createdUser, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, nickname, phone },
      })
    if (createErr || !createdUser?.user) {
      // Race: another request may have created this email between
      // listUsers and createUser. Surface gracefully.
      const msg = createErr?.message ?? ""
      if (/already/i.test(msg) || /registered/i.test(msg)) {
        return NextResponse.json(
          { error: "EMAIL_TAKEN", message: "이미 가입된 이메일입니다." },
          { status: 409 }
        )
      }
      return bad("AUTH_CREATE_FAILED", "사용자 생성에 실패했습니다.", 500)
    }
    const userId = createdUser.user.id

    // ─── 5. Profile upsert ─────────────────────────────────────
    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: userId,
          full_name: fullName,
          nickname,
          phone,
          is_active: true,
        },
        { onConflict: "id" }
      )
    if (profileErr) {
      // Best-effort rollback of auth user so a retry can succeed.
      try { await admin.auth.admin.deleteUser(userId) } catch {}
      return bad("PROFILE_WRITE_FAILED", "프로필 생성에 실패했습니다.", 500)
    }

    // ─── 6. Pending hostess membership ─────────────────────────
    const { error: memErr } = await admin.from("store_memberships").insert({
      profile_id: userId,
      store_uuid: storeUuid,
      role: "hostess",
      status: "pending",
      is_primary: true,
      approved_by: null,
      approved_at: null,
    })
    if (memErr) {
      try { await admin.auth.admin.deleteUser(userId) } catch {}
      return bad("MEMBERSHIP_WRITE_FAILED", "가입 신청 생성에 실패했습니다.", 500)
    }

    // ─── 7. Response ────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      status: "pending",
      message: "회원가입 신청이 접수되었습니다. 운영자 승인 후 로그인할 수 있습니다.",
    })
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "서버 오류." },
      { status: 500 }
    )
  }
}
