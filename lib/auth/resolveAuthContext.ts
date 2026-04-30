import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getCachedAuth, setCachedAuth, type CachedAuth } from "@/lib/auth/authCache"

export type AuthContext = {
  user_id: string
  membership_id: string
  store_uuid: string
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  membership_status: "approved" | "pending" | "rejected" | "suspended"
  // STEP-super-admin: global roles registered in `user_global_roles`
  // (independent of store_memberships). DOES NOT widen the store_uuid scope —
  // the store-scoped `role` + `store_uuid` fields remain authoritative for
  // existing routes. New super-admin routes consult `is_super_admin` to
  // decide whether to accept a `target_store_uuid` param.
  global_roles: string[]
  is_super_admin: boolean
  /**
   * Forced password change gate (invite-flow round 057). Sourced from
   * `profiles.must_change_password`. Exposed here so middleware and
   * privileged routes can decide to block or redirect. Cleared by
   * POST /api/auth/change-password. Optional for backward compat with
   * synthetic `AuthContext` constructions used in denied/cron paths —
   * treat `undefined` as `false` (no forced change).
   */
  must_change_password?: boolean
}

const VALID_ROLES = ["owner", "manager", "waiter", "staff", "hostess"] as const
const VALID_STATUSES = ["approved", "pending", "rejected", "suspended"] as const

export type AuthErrorType =
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "MEMBERSHIP_NOT_FOUND"
  | "MEMBERSHIP_INVALID"
  | "MEMBERSHIP_NOT_APPROVED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "SERVER_CONFIG_ERROR"

export class AuthError extends Error {
  constructor(
    public readonly type: AuthErrorType,
    message: string
  ) {
    super(message)
    this.name = "AuthError"
  }

  /**
   * Canonical HTTP status for this AuthError. Routes are encouraged to
   * use this directly instead of a hardcoded switch, so new error types
   * (e.g. PASSWORD_CHANGE_REQUIRED, added in the api-level-enforcement
   * round) get the correct status without touching every call site.
   * Existing routes with hardcoded switches still work — their unknown
   * types fall through to 500 but the error body keeps the right code.
   */
  get status(): number {
    switch (this.type) {
      case "AUTH_MISSING":
      case "AUTH_INVALID":
        return 401
      case "MEMBERSHIP_NOT_FOUND":
      case "MEMBERSHIP_INVALID":
      case "MEMBERSHIP_NOT_APPROVED":
      case "PASSWORD_CHANGE_REQUIRED":
        return 403
      case "SERVER_CONFIG_ERROR":
        return 500
      default:
        return 500
    }
  }
}

/**
 * Paths exempt from the PASSWORD_CHANGE_REQUIRED gate. These MUST be
 * reachable even when the caller's flag is true, otherwise the user
 * gets locked out with no way to escape (can't log out, can't change
 * password). Mirror of the middleware exemption list.
 */
const MUST_CHANGE_PASSWORD_EXEMPT_PATHS: readonly string[] = [
  "/api/auth/change-password",
  "/api/auth/logout",
]

function isMustChangePasswordExempt(pathname: string): boolean {
  return MUST_CHANGE_PASSWORD_EXEMPT_PATHS.includes(pathname)
}

/**
 * Extract the access token from the request.
 *
 * SECURITY (R-1 remediation): the HttpOnly cookie `nox_access_token` is the
 * PRIMARY and AUTHORITATIVE source. Browser JavaScript cannot read this
 * cookie, so XSS cannot steal the token from a page context.
 *
 * `Authorization: Bearer <token>` header is accepted ONLY as a secondary
 * source for:
 *   - Scripts (seed, cron, server-to-server)
 *   - MCP / IDE integrations that cannot set cookies
 * Browser pages must NOT send this header — `apiFetch` is configured to
 * rely on the cookie via `credentials: "include"`.
 *
 * The function returns the empty string when no token is present; the
 * caller translates that into AUTH_MISSING.
 */
function extractAccessToken(req: Request): string {
  // 1. Cookie first (browser path).
  const cookieHeader = req.headers.get("cookie") ?? ""
  // Minimal cookie parser — avoids an external dep. Stops at the first
  // `nox_access_token=` occurrence.
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim()
    if (trimmed.startsWith("nox_access_token=")) {
      const raw = trimmed.slice("nox_access_token=".length)
      try {
        return decodeURIComponent(raw).trim()
      } catch {
        return raw.trim()
      }
    }
  }
  // 2. Bearer header fallback (scripts / MCP).
  const authHeader = req.headers.get("authorization")
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim()
  }
  return ""
}

/**
 * R-super-admin-view (2026-04-30): super_admin 전용 active context override.
 *
 *   nox_active_store : 활성 매장 store_uuid override (super_admin 만)
 *   nox_active_role  : 활성 역할 enum override (super_admin 만, owner/manager/staff/hostess/waiter)
 *
 * 비-super_admin 의 cookie 는 무시. 검증/오버라이드 적용은 resolveAuthContext
 * 의 마지막 단계에서.
 */
function extractOverrideCookies(req: Request): {
  active_store?: string
  active_role?: string
} {
  const cookieHeader = req.headers.get("cookie") ?? ""
  const out: { active_store?: string; active_role?: string } = {}
  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim()
    if (trimmed.startsWith("nox_active_store=")) {
      const v = decodeURIComponent(trimmed.slice("nox_active_store=".length)).trim()
      if (/^[0-9a-f-]{36}$/i.test(v)) out.active_store = v
    } else if (trimmed.startsWith("nox_active_role=")) {
      const v = decodeURIComponent(trimmed.slice("nox_active_role=".length)).trim()
      if (["owner", "manager", "waiter", "staff", "hostess"].includes(v)) out.active_role = v
    }
  }
  return out
}

/**
 * super_admin 의 active context override 적용.
 *   - active_store 있으면: 해당 store 에 본인 approved membership 이 있는지
 *     검증 후 store_uuid + membership_id 교체.
 *   - active_role  있으면: role enum 만 교체. membership_id 는 store override
 *     의 결과 그대로 (impersonation — audit 용 actor_membership_id 는 실제
 *     row 를 가리키되 actor_role 은 override 값).
 *   - 비-super_admin 이거나 cookie 없으면 ctx 그대로 반환.
 *
 * 실패 정책:
 *   - active_store 가 있는데 해당 매장에 본인 approved membership 부재 →
 *     원본 ctx 반환 (override 무시). 사용자가 잘못된 cookie 를 들고 있어도
 *     기본 정상 매장 경로로 fall-through.
 */
async function applySuperAdminOverride(
  ctx: AuthContext,
  override: { active_store?: string; active_role?: string },
  supabase: ReturnType<typeof getServiceClient>,
): Promise<AuthContext> {
  if (!ctx.is_super_admin) return ctx
  if (!override.active_store && !override.active_role) return ctx

  let next: AuthContext = { ...ctx }

  if (override.active_store && override.active_store !== ctx.store_uuid) {
    const { data: m } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("profile_id", ctx.user_id)
      .eq("store_uuid", override.active_store)
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("role", { ascending: true })  // owner 가 먼저 오도록 (alphabetical: manager < owner — 실제로는 둘 다 있으면 owner 우선 원함)
      .limit(1)
      .maybeSingle()

    if (m) {
      const row = m as { id: string; store_uuid: string; role: string; status: string }
      next = {
        ...next,
        store_uuid: row.store_uuid,
        membership_id: row.id,
        role: row.role as AuthContext["role"],
      }
    }
    // membership 부재 → override 무시. 원본 매장 그대로.
  }

  if (override.active_role && override.active_role !== next.role) {
    // role 만 enum 교체. membership_id 는 store override 결과 유지.
    next = {
      ...next,
      role: override.active_role as AuthContext["role"],
    }
  }

  return next
}

export async function resolveAuthContext(req: Request): Promise<AuthContext> {
  // 1+2. Token extraction — cookie preferred, Bearer fallback.
  const token = extractAccessToken(req)
  if (!token) {
    throw new AuthError("AUTH_MISSING", "Access token is required (cookie or Bearer).")
  }

  // 2b. P0-1: warm-cache short-circuit. If this token was already
  //     resolved within the TTL window on the same function instance,
  //     skip all 3 Supabase round-trips below. Correctness unchanged —
  //     cache entries are only populated after a successful resolution.
  const cached = getCachedAuth(token)
  if (cached) {
    // API-level forced-change gate (api-level-enforcement round).
    //   If the caller's `must_change_password` flag is true, throw a
    //   new AuthError type that every route's catch block will surface
    //   as an auth failure. Exempt the two routes the user MUST still
    //   be able to call while locked (change-password, logout).
    //   Routes with the shared `AuthError.status` getter (or any future
    //   helper) will return 403 naturally. Legacy routes with a
    //   hardcoded switch will return 500 but STILL block (business
    //   logic never executes) — enforcement guaranteed.
    if (cached.must_change_password) {
      const pathname = new URL(req.url).pathname
      if (!isMustChangePasswordExempt(pathname)) {
        throw new AuthError(
          "PASSWORD_CHANGE_REQUIRED",
          "비밀번호를 먼저 변경해야 합니다.",
        )
      }
    }
    const baseCtx: AuthContext = {
      user_id: cached.user_id,
      membership_id: cached.membership_id,
      store_uuid: cached.store_uuid,
      role: cached.role,
      membership_status: cached.membership_status,
      global_roles: cached.global_roles,
      is_super_admin: cached.is_super_admin,
      must_change_password: cached.must_change_password,
    }
    // R-super-admin-view: super_admin override cookie 적용 (cache hit 경로).
    const override = extractOverrideCookies(req)
    if (cached.is_super_admin && (override.active_store || override.active_role)) {
      try {
        const sb = getServiceClient()
        return await applySuperAdminOverride(baseCtx, override, sb)
      } catch {
        return baseCtx
      }
    }
    return baseCtx
  }

  // 3. Supabase 서버 클라이언트 (P0-1: module singleton instead of per-call)
  let supabase
  try {
    supabase = getServiceClient()
  } catch {
    throw new AuthError("SERVER_CONFIG_ERROR", "Supabase environment variables are not configured.")
  }

  // 4. 토큰 검증
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) {
    throw new AuthError("AUTH_INVALID", "Token validation failed.")
  }
  const userId = userData.user.id

  // 5. store_memberships 조회 (profile_id 기준). SECURITY (R-6):
  //    반드시 is_primary=true, deleted_at IS NULL 을 명시. status 는
  //    아래에서 검증한다. 결과가 2건 이상이면 DB 무결성 위반이므로
  //    fail-closed — 비결정적 첫 행을 집어들면 권한 혼동이 발생한다.
  const { data: memberships, error: membershipError } = await supabase
    .from("store_memberships")
    .select("id, store_uuid, role, status")
    .eq("profile_id", userId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(2)

  if (membershipError) {
    throw new AuthError("MEMBERSHIP_INVALID", "Failed to query store memberships.")
  }
  if (!memberships || memberships.length === 0) {
    throw new AuthError("MEMBERSHIP_NOT_FOUND", "No store membership found for this user.")
  }
  if (memberships.length > 1) {
    // Two or more primary memberships for the same profile violates
    // the intended invariant. Refuse to pick one — surface as invalid.
    throw new AuthError(
      "MEMBERSHIP_INVALID",
      "Multiple primary memberships found — data integrity error.",
    )
  }

  // 6. primary membership 사용
  const membership = memberships[0]
  const membershipId = membership.id
  const storeUuid = membership.store_uuid
  const role = membership.role
  const membershipStatus = membership.status

  // 7. 유효성 검증
  if (!storeUuid) {
    throw new AuthError("MEMBERSHIP_INVALID", "store_uuid is null in membership record.")
  }
  if (!VALID_ROLES.includes(role)) {
    throw new AuthError("MEMBERSHIP_INVALID", `Invalid role: ${role}`)
  }
  if (!VALID_STATUSES.includes(membershipStatus)) {
    throw new AuthError("MEMBERSHIP_INVALID", `Invalid membership status: ${membershipStatus}`)
  }

  // 8. approved 상태만 허용 — 미승인 멤버십은 MEMBERSHIP_NOT_APPROVED로 명확히 거부
  if (membershipStatus !== "approved") {
    throw new AuthError("MEMBERSHIP_NOT_APPROVED", `Membership status is '${membershipStatus}'. Only approved memberships can access the system.`)
  }

  // 9. Parallel auxiliary fetches on cache miss:
  //    (a) user_global_roles → super_admin / other global roles
  //    (b) profiles.must_change_password → forced-change gate (invite-flow)
  //    Both are non-fatal; store-scoped auth still succeeds on failure.
  const [globalRolesRes, profileRes] = await Promise.all([
    supabase
      .from("user_global_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("deleted_at", null)
      .then(
        (r) => ({ ok: true as const, data: r.data as { role: string }[] | null }),
        () => ({ ok: false as const, data: null }),
      ),
    supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", userId)
      .maybeSingle()
      .then(
        (r) => ({ ok: true as const, data: r.data as { must_change_password: boolean | null } | null }),
        () => ({ ok: false as const, data: null }),
      ),
  ])

  const globalRoles: string[] = globalRolesRes.ok && globalRolesRes.data
    ? Array.from(new Set(globalRolesRes.data.map((r) => r.role)))
    : []
  const isSuperAdmin = globalRoles.includes("super_admin")

  // Default FALSE on missing row / query failure — fail-open for access
  // (a missing profile row is a pre-existing edge case; we don't want a
  // transient profiles read error to lock the user out). The write path
  // (invite flow) only ever sets TRUE, so a query that returns null here
  // is reliably "no pending reset".
  const mustChangePassword = !!(profileRes.ok && profileRes.data?.must_change_password)

  // 10. AuthContext 반환
  const ctx: AuthContext = {
    user_id: userId,
    membership_id: membershipId,
    store_uuid: storeUuid,
    role: role as AuthContext["role"],
    membership_status: membershipStatus as AuthContext["membership_status"],
    global_roles: globalRoles,
    is_super_admin: isSuperAdmin,
    must_change_password: mustChangePassword,
  }

  // P0-1: populate the warm-instance cache so subsequent calls on this
  // same function instance (e.g. bootstrap's 7 upstream loopbacks that
  // land in the same warm pool slot) skip the 3 Supabase round-trips.
  const toCache: CachedAuth = {
    user_id: ctx.user_id,
    membership_id: ctx.membership_id,
    store_uuid: ctx.store_uuid,
    role: ctx.role,
    membership_status: ctx.membership_status,
    global_roles: ctx.global_roles,
    is_super_admin: ctx.is_super_admin,
    must_change_password: !!ctx.must_change_password,
  }
  setCachedAuth(token, toCache)

  // Same gate applies after a cache-miss resolution. Cache is populated
  // with the current flag value; the next call hits the cache-hit branch
  // above.
  if (ctx.must_change_password) {
    const pathname = new URL(req.url).pathname
    if (!isMustChangePasswordExempt(pathname)) {
      throw new AuthError(
        "PASSWORD_CHANGE_REQUIRED",
        "비밀번호를 먼저 변경해야 합니다.",
      )
    }
  }

  // R-super-admin-view: super_admin override cookie 적용 (cache miss 경로).
  const override = extractOverrideCookies(req)
  if (ctx.is_super_admin && (override.active_store || override.active_role)) {
    return await applySuperAdminOverride(ctx, override, supabase)
  }

  return ctx
}
