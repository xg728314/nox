import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { logAuditEvent, logDeniedAudit } from "@/lib/audit/logEvent"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { randomBytes } from "node:crypto"

/**
 * POST /api/admin/members/create
 *
 * 🔒 회원 생성 — privileged role account creation.
 *
 * Canonical path renamed from `/api/admin/members/invite` in the
 * terminology-alignment round. A thin forwarder still lives at the
 * old path for backward compatibility; do NOT point new callers at
 * the old path.
 *
 * Creates an **approved** store membership for a privileged target role
 * (owner / manager / staff). Companion to the public hostess self-signup
 * (`/api/auth/signup`) — hostess remains `status='pending'` and requires
 * operator approval via `/api/store/approvals`; the invite flow is the
 * ONLY way non-hostess accounts are created.
 *
 * Permission matrix (enforced BEFORE any DB mutation):
 *   - caller.role === "owner" (primary, approved)
 *       → can create {manager, staff, hostess}
 *       → within caller.store_uuid ONLY
 *       → owner CANNOT create another owner (super_admin only)
 *   - caller.role === "manager" (primary, approved)
 *       → can create {hostess} ONLY — hostess internal-creation path
 *       → within caller.store_uuid ONLY
 *       → manager CANNOT create owner / manager / staff
 *   - caller.is_super_admin === true
 *       → can create {owner, manager, staff, hostess}
 *       → across any store
 *   - all other roles (staff, hostess, unauth) → 403
 *
 * Body:
 *   {
 *     email:             string  — required, normalized lowercase
 *     full_name:         string  — required
 *     phone:             string  — required, digits extracted
 *     role:              "owner" | "manager" | "staff" | "hostess"
 *     target_store_uuid: uuid    — required
 *   }
 *
 * Behaviour:
 *   1. Validate all fields.
 *   2. Permission matrix check (role × target_store × target_role).
 *   3. Target store exists + is_active + not deleted.
 *   4. Email duplicate check:
 *        - new auth user → create via admin API + generate temp password
 *        - existing auth user → reuse, but reject if already has an active
 *          membership at target_store (MEMBERSHIP_CONFLICT)
 *   5. Upsert profiles row (full_name / phone / is_active=true).
 *   6. Insert store_memberships row:
 *        role=target_role, status='approved',
 *        approved_by=caller.user_id, approved_at=now(),
 *        is_primary=true  (only when this is the user's FIRST membership;
 *                          otherwise false so existing primary is preserved)
 *   7. audit_events row: action='member_created',
 *        entity_table='store_memberships', entity_id=<new membership_id>,
 *        after.metadata includes target_role / target_store_uuid /
 *        target_profile_id / existing_user flag.
 *   8. Response:
 *        { ok:true, membership_id, profile_id, existing_user,
 *          temp_password? }          // temp_password only for new users
 *
 * SECURITY INVARIANTS (do not remove):
 *   - `store_uuid` from auth.context is the ONLY trusted scope source.
 *     `target_store_uuid` is explicitly compared to it for owners.
 *   - `body.role` is consulted, but ONLY values in the whitelist are
 *     accepted, and the permission matrix further restricts which value
 *     each caller can use.
 *   - Hostess creation via this route is permitted for owner and
 *     manager (this is the internal-only hostess path). Public signup
 *     still rejects role=hostess at its own whitelist; the two flows
 *     do not overlap.
 *   - Existing users are never given a NEW primary membership here — we
 *     preserve whatever primary they already have. Only brand-new
 *     profiles get is_primary=true (their first and only membership).
 *   - All failure paths that created intermediate state (auth user
 *     without membership) roll back best-effort.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE_MIN = 9
const PHONE_MAX = 15

const ALLOWED_ROLES = ["owner", "manager", "staff", "hostess"] as const
type AllowedRole = typeof ALLOWED_ROLES[number]

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Generate a URL-safe temporary password. Entropy: 18 random bytes →
 * base64url; suffix guarantees 1 upper / 1 digit / 1 symbol for any
 * Supabase policy that requires character-class diversity. Suffix is
 * fixed-string so it doesn't reduce the randomness of the leading bytes.
 */
function genTempPassword(): string {
  const random = randomBytes(18).toString("base64url").slice(0, 16)
  return `${random}A1!`
}

export async function POST(request: Request) {
  // ─── Auth ───────────────────────────────────────────────────
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

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true

  // ─── Permission gate (coarse) ───────────────────────────────
  //   Allowed callers: owner, manager, super_admin.
  //   Manager is only allowed the hostess sub-path; that narrower
  //   check is enforced below in the fine-grained matrix.
  if (!isOwner && !isManager && !isSuperAdmin) {
    try {
      await logDeniedAudit(supa(), {
        auth,
        action: "member_created",
        entity_table: "store_memberships",
        reason: "caller role not permitted",
      })
    } catch {}
    return bad("ROLE_FORBIDDEN", "회원 생성 권한이 없습니다.", 403)
  }

  // ─── Durable rate limit (per-actor) ─────────────────────────
  //   Scope: authenticated actor (user_id). 10 requests / 600 s.
  //   Defeats internal abuse (mass-invite spam, enumeration via error
  //   codes) while leaving headroom for legitimate onboarding of a
  //   small staff batch. Same rateLimitDurable helper used by auth
  //   signup / login for consistency.
  //
  //   On DB failure of the limiter we return 503 (like other endpoints)
  //   — FAIL CLOSED rather than silently allowing unlimited invites.
  try {
    const rlAdmin = supa()
    const rl = await rateLimitDurable(rlAdmin, {
      key: `admin_member_create:actor:${auth.user_id}`,
      action: "admin_member_create",
      limit: 10,
      windowSeconds: 600,
    })
    if (!rl.ok) {
      const status = rl.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        {
          error:
            rl.reason === "db_error"
              ? "SECURITY_STATE_UNAVAILABLE"
              : "RATE_LIMITED",
          message:
            rl.reason === "db_error"
              ? "레이트 리미트 상태 확인에 실패했습니다. 잠시 후 다시 시도하세요."
              : "회원 생성 요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
        },
        { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } },
      )
    }
  } catch {
    return bad("SERVER_CONFIG_ERROR", "서버 설정 오류.", 500)
  }

  // ─── Parse + validate body ──────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown; full_name?: unknown; phone?: unknown
    role?: unknown; target_store_uuid?: unknown
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
  const phoneRaw = typeof body.phone === "string" ? body.phone : ""
  const phone = phoneRaw.replace(/\D/g, "")
  const role = typeof body.role === "string" ? body.role : ""
  const targetStoreUuid =
    typeof body.target_store_uuid === "string" ? body.target_store_uuid.trim() : ""

  if (!email) return bad("MISSING_FIELDS", "이메일을 입력하세요.")
  if (!EMAIL_RE.test(email)) return bad("EMAIL_INVALID", "이메일 형식이 올바르지 않습니다.")
  if (!fullName) return bad("MISSING_FIELDS", "이름을 입력하세요.")
  if (!phone) return bad("MISSING_FIELDS", "전화번호를 입력하세요.")
  if (phone.length < PHONE_MIN || phone.length > PHONE_MAX)
    return bad("PHONE_INVALID", "전화번호 형식을 확인하세요.")
  if (!ALLOWED_ROLES.includes(role as AllowedRole))
    return bad("ROLE_INVALID", "role 은 owner / manager / staff / hostess 중 하나여야 합니다.")
  if (!UUID_RE.test(targetStoreUuid))
    return bad("STORE_UUID_INVALID", "target_store_uuid 가 UUID 형식이 아닙니다.")

  const targetRole = role as AllowedRole

  // ─── Permission matrix (fine-grained) ───────────────────────
  //   super_admin → any target role, any store
  //   manager    → target ∈ {hostess} only, store = own
  //   owner      → target ∈ {manager, staff, hostess}, store = own
  //                (owner cannot bootstrap another owner — super_admin only)
  if (!isSuperAdmin) {
    // Cross-store denied for non-super_admin (owner/manager).
    if (targetStoreUuid !== auth.store_uuid) {
      try {
        await logDeniedAudit(supa(), {
          auth,
          action: "member_created",
          entity_table: "store_memberships",
          reason: "caller cannot cross store",
          metadata: { target_role: targetRole, target_store_uuid: targetStoreUuid },
        })
      } catch {}
      return bad("STORE_SCOPE_FORBIDDEN", "본인 매장 외에는 회원을 생성할 수 없습니다.", 403)
    }

    if (isManager) {
      // Manager is restricted to hostess only.
      if (targetRole !== "hostess") {
        try {
          await logDeniedAudit(supa(), {
            auth,
            action: "member_created",
            entity_table: "store_memberships",
            reason: "manager can create hostess only",
            metadata: { target_role: targetRole, target_store_uuid: targetStoreUuid },
          })
        } catch {}
        return bad(
          "ROLE_FORBIDDEN",
          "실장(manager)은 아가씨(hostess) 계정만 생성할 수 있습니다.",
          403,
        )
      }
    } else if (isOwner) {
      // Owner cannot create another owner.
      if (targetRole === "owner") {
        try {
          await logDeniedAudit(supa(), {
            auth,
            action: "member_created",
            entity_table: "store_memberships",
            reason: "owner cannot create owner",
            metadata: { target_role: targetRole, target_store_uuid: targetStoreUuid },
          })
        } catch {}
        return bad(
          "ROLE_FORBIDDEN",
          "사장(owner) 계정은 운영자(super_admin)만 생성할 수 있습니다.",
          403,
        )
      }
      // owner is free to create manager / staff / hostess at own store.
    }
  }

  // ─── Begin mutation path ────────────────────────────────────
  let admin
  try {
    admin = supa()
  } catch {
    return bad("SERVER_CONFIG_ERROR", "서버 설정 오류.", 500)
  }

  // 1. Target store: exists + active + not deleted
  const { data: storeRow, error: storeErr } = await admin
    .from("stores")
    .select("id, store_name, is_active")
    .eq("id", targetStoreUuid)
    .is("deleted_at", null)
    .maybeSingle()
  if (storeErr) {
    return bad("INTERNAL_ERROR", "매장 조회에 실패했습니다.", 500)
  }
  if (!storeRow || storeRow.is_active === false) {
    return bad("STORE_INVALID", "대상 매장이 존재하지 않거나 비활성 상태입니다.")
  }

  // 2. Email duplicate check: does an auth user with this email exist?
  const { data: existingUsers, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) {
    return bad("INTERNAL_ERROR", "사용자 조회에 실패했습니다.", 500)
  }
  const existingByEmail = existingUsers?.users?.find(
    (u) => (u.email ?? "").toLowerCase() === email,
  )

  let userId: string
  let isExistingUser = false
  let tempPassword: string | null = null

  if (existingByEmail) {
    userId = existingByEmail.id
    isExistingUser = true

    // Existing user must not already have ANY active (non-deleted)
    // membership at the target store — even different role / status.
    // This prevents accidentally double-enrolling someone.
    const { data: existingMem, error: dupMemErr } = await admin
      .from("store_memberships")
      .select("id, role, status")
      .eq("profile_id", userId)
      .eq("store_uuid", targetStoreUuid)
      .is("deleted_at", null)
      .limit(1)
    if (dupMemErr) {
      return bad("INTERNAL_ERROR", "멤버십 조회에 실패했습니다.", 500)
    }
    if (existingMem && existingMem.length > 0) {
      return NextResponse.json(
        {
          error: "MEMBERSHIP_CONFLICT",
          message: "해당 사용자는 이미 이 매장에 멤버십이 있습니다.",
        },
        { status: 409 },
      )
    }
  } else {
    // Brand-new auth user.
    tempPassword = genTempPassword()
    const { data: createdUser, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone,
          created_via: "admin_member_create",
        },
      })
    if (createErr || !createdUser?.user) {
      const msg = createErr?.message ?? ""
      if (/already/i.test(msg) || /registered/i.test(msg)) {
        return NextResponse.json(
          { error: "EMAIL_TAKEN", message: "이미 가입된 이메일입니다." },
          { status: 409 },
        )
      }
      return bad("AUTH_CREATE_FAILED", "사용자 생성에 실패했습니다.", 500)
    }
    userId = createdUser.user.id
  }

  // 3. Profile upsert — preserves any existing profile fields on existing
  //    users (upsert with id conflict; we only rewrite the columns we set).
  //
  //    must_change_password: TRUE only on new-user creation (invite-flow
  //    round 057). Existing users keep their current flag — we must not
  //    force a re-change for someone who already has a password they
  //    manage, just because they were invited to an additional store.
  const profilePayload: Record<string, unknown> = {
    id: userId,
    full_name: fullName,
    phone,
    is_active: true,
  }
  if (!isExistingUser) {
    profilePayload.must_change_password = true
  }
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" })
  if (profileErr) {
    // Rollback auth user we just created (existing users are untouched).
    if (!isExistingUser) {
      try { await admin.auth.admin.deleteUser(userId) } catch {}
    }
    return bad("PROFILE_WRITE_FAILED", "프로필 생성에 실패했습니다.", 500)
  }

  // 4. Membership insert — is_primary semantics:
  //    - New user (no pre-existing memberships) → is_primary=true
  //      (this is their login identity).
  //    - Existing user with other memberships → is_primary=false.
  //      Their current primary membership is preserved; the new row is
  //      secondary. Switching primary is a separate admin action, not
  //      part of invite.
  //    Determining "first-ever" for new users is trivial; for existing
  //    users we explicitly set false.
  const isPrimary = !isExistingUser

  const { data: memRow, error: memErr } = await admin
    .from("store_memberships")
    .insert({
      profile_id: userId,
      store_uuid: targetStoreUuid,
      role: targetRole,
      status: "approved",
      is_primary: isPrimary,
      approved_by: auth.user_id,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (memErr || !memRow) {
    // Rollback: profile upsert is idempotent so no need to revert.
    // Auth user: rollback only if WE created it.
    if (!isExistingUser) {
      try { await admin.auth.admin.deleteUser(userId) } catch {}
    }
    return bad("MEMBERSHIP_WRITE_FAILED", "멤버십 생성에 실패했습니다.", 500)
  }

  const membershipId = memRow.id as string

  // 4b. Hostess role → also insert into `hostesses` table so the new
  //     account shows up in manager-scoped queries (assigned hostess
  //     list, manager settlement summary, name-match pool, etc).
  //     manager_membership_id auto-binding rule:
  //       - caller is manager  → manager_membership_id = caller.membership_id
  //                              (manager creates own assigned hostess)
  //       - caller is owner    → manager_membership_id = null
  //                              (unassigned; manager picks up later)
  //       - caller is super_admin
  //                            → manager_membership_id = null
  //     This mirrors how /api/manager/hostesses reads the assignment.
  //     If this insert fails we roll back the store_memberships row and
  //     (for new users) the auth user, so the account is not half-created.
  if (targetRole === "hostess") {
    const managerMembershipId = isManager ? auth.membership_id : null
    const { error: hostErr } = await admin
      .from("hostesses")
      .insert({
        store_uuid: targetStoreUuid,
        membership_id: membershipId,
        manager_membership_id: managerMembershipId,
        name: fullName,
        phone,
        is_active: true,
      })
    if (hostErr) {
      // Rollback store_memberships (hard-delete — we just inserted it)
      try { await admin.from("store_memberships").delete().eq("id", membershipId) } catch {}
      if (!isExistingUser) {
        try { await admin.auth.admin.deleteUser(userId) } catch {}
      }
      return bad("HOSTESS_WRITE_FAILED", "아가씨 레코드 생성에 실패했습니다.", 500)
    }
  }

  // 5. Audit — best-effort, does not block success response on failure.
  try {
    await logAuditEvent(admin, {
      auth,
      action: "member_created",
      entity_table: "store_memberships",
      entity_id: membershipId,
      metadata: {
        target_role: targetRole,
        target_store_uuid: targetStoreUuid,
        target_profile_id: userId,
        target_email: email,
        existing_user: isExistingUser,
        via: "admin_member_create",
        // Hostess auto-assignment trace — helps post-hoc who-assigned-whom
        // queries without reading the hostesses row directly.
        ...(targetRole === "hostess"
          ? { manager_membership_id: isManager ? auth.membership_id : null }
          : {}),
      },
    })
  } catch {
    // Logged by helper; never rethrown.
  }

  // 6. Response
  const payload: {
    ok: true
    membership_id: string
    profile_id: string
    existing_user: boolean
    temp_password?: string
    message?: string
  } = {
    ok: true,
    membership_id: membershipId,
    profile_id: userId,
    existing_user: isExistingUser,
    message: isExistingUser
      ? "기존 사용자에게 멤버십이 추가되었습니다."
      : "신규 사용자 계정이 생성되었습니다. 임시 비밀번호를 본인에게 안전하게 전달하세요.",
  }
  if (tempPassword) payload.temp_password = tempPassword

  return NextResponse.json(payload)
}
