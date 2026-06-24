import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { getClientIp } from "@/lib/security/clientIp"

/**
 * POST /api/auth/signup
 *
 * General member signup. Producer for the approvals consumer
 * (app/api/store/approvals/route.ts).
 *
 * Flow:
 *   1. Validate inputs (seven fields: store / role / full_name /
 *      nickname / phone / email / password).
 *   2. Resolve the selected store_name → store_uuid (active stores only).
 *   3. Role whitelist: body.role must be one of
 *      {owner, manager, staff}. Any other value (including hostess)
 *      is rejected with 400 ROLE_INVALID.
 *   4. Pre-check duplicates at the application layer:
 *        a. email already exists in auth.users → EMAIL_TAKEN
 *        b. (phone, store, role) already has a non-rejected membership
 *           with status pending or approved → ALREADY_REGISTERED_AT_STORE
 *   5. Create the auth user via service-role admin API.
 *   6. Upsert the profile (full_name / nickname / phone).
 *   7. Insert one store_memberships row:
 *        role=<selected>, status='pending', is_primary=true,
 *        approved_by=null, approved_at=null
 *   8. Return { ok:true, status:'pending', role, message:... }.
 *
 * Notes:
 *   - login route is NOT modified; the existing MEMBERSHIP_NOT_APPROVED
 *     gate handles the pending state for free.
 *   - approvals route is NOT modified.
 *   - No migration. No schema change.
 */

const PHONE_DIGIT_MIN = 9
const PHONE_DIGIT_MAX = 15
const PASSWORD_MIN = 6
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SignupBody = {
  store?: unknown
  role?: unknown
  full_name?: unknown
  nickname?: unknown
  phone?: unknown
  email?: unknown
  password?: unknown
}

// 2026-06-08 R-사전등록: hostess role 추가. 단 사전등록 (manager 가 미리 등록)
//   이 있어야만 통과. 가입 즉시 사전등록 row 와 자동 연동.
const ALLOWED_SIGNUP_ROLES = ["owner", "manager", "staff", "hostess"] as const
type AllowedSignupRole = typeof ALLOWED_SIGNUP_ROLES[number]

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SignupBody

    // ─── 1. Validate ────────────────────────────────────────────
    const store = typeof body.store === "string" ? body.store.trim() : ""
    const roleRaw = typeof body.role === "string" ? body.role.trim() : ""
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : ""
    const phoneRaw = typeof body.phone === "string" ? body.phone : ""
    const phone = phoneRaw.replace(/\D/g, "")
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""

    if (!store) return bad("MISSING_FIELDS", "소속 매장을 선택하세요.")
    if (!roleRaw) return bad("MISSING_FIELDS", "직책을 선택하세요.")
    if (!(ALLOWED_SIGNUP_ROLES as readonly string[]).includes(roleRaw)) {
      return bad(
        "ROLE_INVALID",
        "직책은 사장 / 실장 / 스테프 중 하나여야 합니다.",
      )
    }
    const role = roleRaw as AllowedSignupRole
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

    // ─── 2b. hostess role: phantom 전환 흐름 (2026-06-12 R-phantom-immediate) ──
    //   기존: pre_registration 찾고 새 user/mem/hostess 만들기.
    //   변경: 실장/사장이 이미 phantom 식구로 즉시 등록함 (phone+이름).
    //         스태프 본인은 같은 phone+이름으로 가입 시 phantom user 의
    //         email/password 만 진짜로 갱신 (admin.updateUserById).
    //         profile/membership/hostess row 모두 그대로 → row UUID 안정.
    //
    //   phantom 식별: auth.users.email 이 @nox-phantom.local 도메인.
    //   매칭 키: profiles.phone + profiles.full_name.
    const PHANTOM_DOMAIN = "nox-phantom.local"
    type PhantomMatch = { profileId: string; phantomEmail: string }
    let phantomMatch: PhantomMatch | null = null
    if (role === "hostess") {
      // phone + name 매칭 profile 들 후보
      const { data: candidates, error: candErr } = await admin
        .from("profiles")
        .select("id, full_name, phone")
        .eq("phone", phone)
        .eq("full_name", fullName)
        .is("deleted_at", null)
      if (candErr) {
        return bad("INTERNAL_ERROR", "프로필 조회에 실패했습니다.", 500)
      }
      // 그 중 phantom auth user 찾기 (이메일 도메인 = @nox-phantom.local)
      for (const p of candidates ?? []) {
        const { data: u } = await admin.auth.admin.getUserById(p.id as string)
        const userEmail = u?.user?.email ?? ""
        if (userEmail.endsWith(`@${PHANTOM_DOMAIN}`)) {
          // 해당 phantom 이 신청 매장에 hostess membership 가지고 있는지 확인
          const { data: mem } = await admin
            .from("store_memberships")
            .select("id")
            .eq("profile_id", p.id as string)
            .eq("store_uuid", storeUuid)
            .eq("role", "hostess")
            .is("deleted_at", null)
            .maybeSingle()
          if (mem) {
            phantomMatch = { profileId: p.id as string, phantomEmail: userEmail }
            break
          }
        }
      }
      if (!phantomMatch) {
        return bad(
          "NOT_PRE_REGISTERED",
          "본인이 등록되지 않았습니다. 매장 실장에게 이름+전화로 사전등록 요청해주세요.",
          403,
        )
      }
    }

    // ─── 2c. hostess + phantom 매칭 — fast-path 전환 후 즉시 return ──
    //   phantom user 의 email + password 만 진짜로 갱신.
    //   profile / membership / hostess row 그대로 (UUID 안정성).
    //   아래 EMAIL_TAKEN / phone dup / createUser 흐름 전부 skip.
    if (role === "hostess" && phantomMatch) {
      const { error: updErr } = await admin.auth.admin.updateUserById(
        phantomMatch.profileId,
        {
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, nickname, phone, phantom: false },
        },
      )
      if (updErr) {
        const msg = updErr.message ?? ""
        if (/already/i.test(msg) || /registered/i.test(msg) || /taken/i.test(msg)) {
          return NextResponse.json(
            { error: "EMAIL_TAKEN", message: "이미 가입된 이메일입니다." },
            { status: 409 },
          )
        }
        return bad("PHANTOM_UPDATE_FAILED", `자동 연동 실패: ${msg}`, 500)
      }

      // profile 도 nickname 추가 / 최신화
      await admin
        .from("profiles")
        .upsert(
          {
            id: phantomMatch.profileId,
            full_name: fullName,
            nickname,
            phone,
            is_active: true,
          },
          { onConflict: "id" },
        )

      return NextResponse.json({
        ok: true,
        status: "approved",
        role: "hostess",
        auto_linked: true,
        message: "사전등록 매칭 — 자동 연동 완료. 바로 로그인할 수 있습니다.",
      })
    }

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
    //          as the SAME role at the same store ────────────────
    // Join via profiles → store_memberships. We pre-resolve profile
    // ids whose phone matches, then look for any non-rejected
    // membership at the target store with the SELECTED role. This
    // lets the same person hold different roles at different stores
    // (or sequentially over time) without tripping the dup check.
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
        .eq("role", role)
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

    // ─── Rollback helper (2026-04-30 hardening) ──────────────────
    //   기존: try { deleteUser } catch {} — silent. 실패 시 auth.users 만
    //   남는 orphan 누적 (DB 실사: 4/22 자 가입 실패 2건 흔적 발견).
    //   변경: 실패 / 성공 모두 system_errors 에 기록. orphan 정리 스크립트
    //   가 추적 가능. 실패한 rollback 도 cleanup 대상으로 명확히.
    const rollbackAuthUser = async (reason: string) => {
      try {
        const { error: delErr } = await admin.auth.admin.deleteUser(userId)
        if (delErr) {
          await admin.from("system_errors").insert({
            tag: "signup_rollback_failed",
            error_name: "RollbackError",
            error_message: `auth user delete failed during signup rollback: ${delErr.message}`,
            extra: { user_id: userId, email, reason, supabase_error: delErr.message },
          }).then(() => {}, () => {})
        } else {
          await admin.from("system_errors").insert({
            tag: "signup_rollback",
            error_name: "INFO",
            error_message: `auth user rolled back: reason=${reason}`,
            extra: { user_id: userId, email, reason },
            resolved_at: new Date().toISOString(), // 정상 rollback 은 즉시 resolved
          }).then(() => {}, () => {})
        }
      } catch (e) {
        // 최후의 예외 — system_errors insert 자체가 실패해도 호출자는 응답해야.
        // eslint-disable-next-line no-console
        console.error("[signup rollback] catastrophic:", e)
      }
    }

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
      await rollbackAuthUser(`profile_upsert_failed: ${profileErr.message}`)
      return bad("PROFILE_WRITE_FAILED", "프로필 생성에 실패했습니다.", 500)
    }

    // ─── 6. Membership 생성 — 즉시 approved (2026-06-24 R-signup-auto-approve)
    //     기존: status='pending' → 운영자 승인 대기.
    //     변경: 가입 즉시 'approved'. 운영자 승인 step 제거. approved_at
    //           을 NOW 로 stamp (approved_by 는 null = 시스템 자동 승인).
    //     hostess 는 위 fast-path 에서 return 되었으므로 이 분기 도달 안 함.
    const { error: memErr } = await admin.from("store_memberships").insert({
      profile_id: userId,
      store_uuid: storeUuid,
      role,
      status: "approved",
      is_primary: true,
      approved_by: null,
      approved_at: new Date().toISOString(),
    })
    if (memErr) {
      // 또한 profile 도 정리 — auth.users 와 함께 rollback.
      try { await admin.from("profiles").delete().eq("id", userId) } catch { /* best-effort */ }
      await rollbackAuthUser(`membership_insert_failed: ${memErr.message}`)
      return bad("MEMBERSHIP_WRITE_FAILED", "가입 신청 생성에 실패했습니다.", 500)
    }

    // ─── 7. Response ────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      status: "approved",
      role,
      auto_approved: true,
      message: "회원가입 완료. 바로 로그인할 수 있습니다.",
    })
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "서버 오류." },
      { status: 500 }
    )
  }
}
