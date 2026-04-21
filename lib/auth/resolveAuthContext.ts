import { createClient } from "@supabase/supabase-js"

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
}

const VALID_ROLES = ["owner", "manager", "waiter", "staff", "hostess"] as const
const VALID_STATUSES = ["approved", "pending", "rejected", "suspended"] as const

export class AuthError extends Error {
  constructor(
    public readonly type:
      | "AUTH_MISSING"
      | "AUTH_INVALID"
      | "MEMBERSHIP_NOT_FOUND"
      | "MEMBERSHIP_INVALID"
      | "MEMBERSHIP_NOT_APPROVED"
      | "SERVER_CONFIG_ERROR",
    message: string
  ) {
    super(message)
    this.name = "AuthError"
  }
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

export async function resolveAuthContext(req: Request): Promise<AuthContext> {
  // 1+2. Token extraction — cookie preferred, Bearer fallback.
  const token = extractAccessToken(req)
  if (!token) {
    throw new AuthError("AUTH_MISSING", "Access token is required (cookie or Bearer).")
  }

  // 3. Supabase 서버 클라이언트 생성
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new AuthError("SERVER_CONFIG_ERROR", "Supabase environment variables are not configured.")
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

  // 9. Global role lookup (super_admin etc.).
  //    Failure here is non-fatal — store-scoped auth still succeeds. Only
  //    super-admin-gated endpoints care about this value.
  let globalRoles: string[] = []
  try {
    const { data: gr } = await supabase
      .from("user_global_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("deleted_at", null)
    globalRoles = Array.from(new Set((gr ?? []).map((r: { role: string }) => r.role)))
  } catch {
    globalRoles = []
  }
  const isSuperAdmin = globalRoles.includes("super_admin")

  // 10. AuthContext 반환
  return {
    user_id: userId,
    membership_id: membershipId,
    store_uuid: storeUuid,
    role: role as AuthContext["role"],
    membership_status: membershipStatus as AuthContext["membership_status"],
    global_roles: globalRoles,
    is_super_admin: isSuperAdmin,
  }
}
