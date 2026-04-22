import { NextResponse, type NextRequest } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getCachedAuth, setCachedAuth } from "@/lib/auth/authCache"

/**
 * STEP-002B: Server-side page protection via HttpOnly cookie.
 *
 * Reads the `nox_access_token` cookie set by /api/auth/login and
 * /api/auth/login/mfa, resolves the Supabase user, and looks up the
 * caller's primary-approved membership to obtain `role`. Enforces the
 * route-access matrix BEFORE protected pages render.
 *
 * Scope (intentionally narrow):
 *   - Only page routes listed in `config.matcher` are intercepted.
 *   - /api/*, /_next/*, static assets, and the public auth/hostess
 *     pages (/login, /signup, /find-id, /reset-password, /me, /)
 *     are NOT included in the matcher → middleware is skipped.
 *   - API route authentication is unchanged (still Bearer via
 *     resolveAuthContext). This middleware only gates page UI.
 *
 * Fail-closed: any missing cookie, invalid token, or missing /
 * unapproved membership redirects to /login. No error details leak.
 *
 * Policy matrix (derived from existing client-side guards — see
 * app/manager/page.tsx:63, app/manager/settlement/page.tsx:23):
 *   - owner only:   /owner, /admin, /approvals, /inventory, /ops,
 *                   /reports, /audit, /audit-events, /operating-days,
 *                   /credits, /payouts, /attendance
 *   - manager only: /manager
 *   - owner|manager|waiter|staff: /counter, /transfer, /staff, /customers
 *   - hostess: no protected UI → redirected to /me
 */

type Role = "owner" | "manager" | "waiter" | "staff" | "hostess"

// P0 권한 정렬 (2026-04-18):
//   실제 페이지 설계 + API 허용 role과 미들웨어가 맞지 않아 owner 외 role이
//   자기 전용 메뉴를 눌러도 307로 /counter로 튕기는 문제가 있었다. 각 그룹을
//   API/페이지와 같은 role 집합으로 재분류한다.
//
//   변경 요약:
//     - /inventory /credits /attendance /payouts /operating-days
//       → OWNER_ONLY → OWNER_MANAGER 로 이동
//       (API: owner+manager 모두 허용. 페이지: L45/L31/L54/L47/L76 등에서
//        owner+manager 모두 통과시키도록 이미 설계되어 있음.
//        쓰기(마감/등록/삭제) 같은 owner-only 동작은 각 페이지/API 내부에서
//        이미 별도 분기로 차단한다. 이 가드는 변경하지 않는다.)
//     - /customers /staff
//       → COUNTER_ROLE_PREFIXES → OWNER_MANAGER 로 이동
//       (API: owner+manager 전용. waiter/staff role이 진입해도 API 403으로
//        빈 화면이 되는 이전 UX 수정.)
//   유지:
//     - /owner, /admin, /approvals, /ops, /reports, /audit, /audit-events
//       은 owner-only 그대로.
//     - /manager 는 manager-only 그대로.
//     - /counter, /transfer 는 COUNTER_ROLE_PREFIXES 유지.

const OWNER_ONLY_PREFIXES = [
  "/owner",
  "/admin",
  "/approvals",
  "/ops",
  "/reports",
  "/audit",
  "/audit-events",
]

const OWNER_MANAGER_PREFIXES = [
  "/inventory",
  "/operating-days",
  "/credits",
  "/payouts",
  "/attendance",
  "/customers",
  "/staff",
  // BLE analytics dashboard: explicit carve-out inside /ops so owners
  // AND managers can see own-store accuracy data. Other /ops paths
  // remain owner-only. OWNER_MANAGER is checked BEFORE OWNER_ONLY
  // below so this more-specific path matches first.
  "/ops/ble-analytics",
  // Phase 4 (BLE monitor round): owner+manager 자기 매장 검수 로그.
  // /admin 트리는 원래 owner-only 이지만 이 하위 경로는 manager 도
  // 자기 매장 범위에서 열람할 필요가 있다. OWNER_MANAGER 가
  // OWNER_ONLY 보다 먼저 매칭되므로 더 구체적인 이 prefix 가 승리.
  // 서버 필터(`corrected_by_store_uuid = auth.store_uuid`)가 데이터
  // 범위를 강제한다.
  "/admin/location-corrections",
]

const MANAGER_ONLY_PREFIXES = ["/manager"]

const COUNTER_ROLE_PREFIXES = [
  "/counter",
  "/transfer",
  // Phase 5 (BLE monitor round): mobile monitor tree.
  // owner / manager / waiter / staff 모두 접근 가능.
  // hostess 는 기존 /me redirect 로직에 따름.
  // super_admin 은 is_super_admin 플래그로 모든 범위 조회 가능.
  "/m/monitor",
]

// STEP-super-admin: prefixes that require the global `super_admin` role
// (verified against `user_global_roles`). These are NOT owner-accessible —
// owner role only sees their own store. super_admin is a separate, global
// tier that must be explicitly granted.
const SUPER_ADMIN_ONLY_PREFIXES = ["/super-admin"]

// Invite-flow round (renamed in members-UI restructure): prefixes
// where EITHER `owner` role OR `is_super_admin=true` is sufficient.
// A precise carve-out against the broader OWNER_ONLY `/admin` tree:
//   - /admin/members/create   회원 생성 (privileged role creation)
// All other /admin/* paths remain strict owner-only via the unchanged
// OWNER_ONLY_PREFIXES check below.
const SUPER_ADMIN_OR_OWNER_PREFIXES = ["/admin/members/create"]

const COUNTER_ALLOWED_ROLES: readonly Role[] = ["owner", "manager", "waiter", "staff"]

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  for (const p of prefixes) {
    if (pathname === p || pathname.startsWith(p + "/")) return true
  }
  return false
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = path
  url.search = ""
  return NextResponse.redirect(url)
}

// API-level forced-change enforcement (api-level-enforcement round).
//   These API paths MUST be reachable even when the caller's
//   `must_change_password` flag is true — otherwise the user has no
//   way to escape the locked state:
//     - change-password: the only way to clear the flag
//     - logout:          the only way to discard the session
//   Other auth-public paths (login/signup/reset-password/find-id) and
//   cron paths are also skipped because either (a) the caller has no
//   session yet or (b) auth is out-of-band (Bearer/user-agent cron
//   secret). Skipping those prevents spurious redirect / JSON 403.
const API_FLAG_EXEMPT_EXACT: readonly string[] = [
  "/api/auth/change-password",
  "/api/auth/logout",
]
const API_FLAG_EXEMPT_PREFIXES: readonly string[] = [
  "/api/auth/",     // login / signup / find-id / reset-password / me / ...
  "/api/cron/",     // cron jobs (separate auth)
]

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/")
}

function isApiFlagExempt(pathname: string): boolean {
  if (API_FLAG_EXEMPT_EXACT.includes(pathname)) return true
  for (const p of API_FLAG_EXEMPT_PREFIXES) {
    if (pathname.startsWith(p)) return true
  }
  return false
}

function jsonPasswordChangeRequired(): NextResponse {
  return NextResponse.json(
    {
      error: "PASSWORD_CHANGE_REQUIRED",
      message: "비밀번호를 먼저 변경해야 합니다.",
    },
    { status: 403 },
  )
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  // ─────────────────────────────────────────────────────────────
  //  API branch (api-level-enforcement round)
  //
  //  For /api/* paths we do a LIGHT middleware pass:
  //   - exempt auth/cron routes → pass through untouched
  //   - else check authCache for the must_change_password flag
  //   - on cache hit + flag=true → JSON 403 PASSWORD_CHANGE_REQUIRED
  //   - on cache miss → pass through; the route's own
  //     resolveAuthContext will throw PASSWORD_CHANGE_REQUIRED (Layer 1)
  //  This gives correct 403 status on the hot (cache-hit) path while
  //  keeping cold-start cost minimal (no extra Supabase query in
  //  middleware). Layer 1 in resolveAuthContext guarantees enforcement
  //  even when the cache is cold.
  // ─────────────────────────────────────────────────────────────
  if (isApiPath(pathname)) {
    if (isApiFlagExempt(pathname)) {
      return NextResponse.next()
    }
    const apiToken = req.cookies.get("nox_access_token")?.value
    if (!apiToken) {
      // Unauthenticated API request → let the route's auth check
      // decide (likely 401). Middleware does not duplicate 401 logic.
      return NextResponse.next()
    }
    const apiCached = getCachedAuth(apiToken)
    if (apiCached?.must_change_password) {
      return jsonPasswordChangeRequired()
    }
    return NextResponse.next()
  }

  // ─────────────────────────────────────────────────────────────
  //  Page branch (original middleware behavior)
  // ─────────────────────────────────────────────────────────────

  // 1. Cookie presence check — fail-closed on missing.
  const token = req.cookies.get("nox_access_token")?.value
  if (!token) {
    return redirectTo(req, "/login")
  }

  // 2. P0-1: warm-cache short-circuit. If this token was fully
  //    resolved within the TTL window on this function instance, skip
  //    both auth.getUser and store_memberships queries (-400 ms on
  //    cross-region deployments). Same role / same membership / same
  //    validity — only the network trip is elided.
  const cached = getCachedAuth(token)
  let userId: string
  let role: Role
  let mustChangePassword = false
  let supabase: ReturnType<typeof getServiceClient> | null = null
  if (cached) {
    userId = cached.user_id
    role = cached.role as Role
    mustChangePassword = cached.must_change_password
  } else {
    // 2b. Supabase env — fail-closed on misconfiguration.
    try {
      supabase = getServiceClient()
    } catch {
      return redirectTo(req, "/login")
    }

    // 3. Validate token → user_id. Any failure → /login.
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser(token)
      if (userError || !userData.user) {
        return redirectTo(req, "/login")
      }
      userId = userData.user.id
    } catch {
      return redirectTo(req, "/login")
    }

    // 4. Resolve primary-approved membership (mirrors resolveAuthContext
    //    lines 62-97 — is_primary=true, deleted_at IS NULL, status='approved').
    //    Also fetch `profiles.must_change_password` in parallel for the
    //    forced-change redirect below. Both queries run against the same
    //    Supabase client, Promise.all parallelized.
    try {
      const [memRes, profRes] = await Promise.all([
        supabase
          .from("store_memberships")
          .select("id, store_uuid, role, status")
          .eq("profile_id", userId)
          .eq("is_primary", true)
          .is("deleted_at", null)
          .limit(2),
        supabase
          .from("profiles")
          .select("must_change_password")
          .eq("id", userId)
          .maybeSingle(),
      ])
      const { data: memberships, error: mErr } = memRes
      if (mErr || !memberships || memberships.length === 0) {
        return redirectTo(req, "/login")
      }
      if (memberships.length > 1) {
        // Data integrity violation — refuse access.
        return redirectTo(req, "/login")
      }
      const m = memberships[0] as { id: string; store_uuid: string; role: string; status: string }
      if (m.status !== "approved") {
        return redirectTo(req, "/login")
      }
      const validRoles: readonly Role[] = ["owner", "manager", "waiter", "staff", "hostess"]
      if (!validRoles.includes(m.role as Role)) {
        return redirectTo(req, "/login")
      }
      role = m.role as Role

      // Forced-change gate — sourced from profiles. Missing row / query
      // failure defaults to false (fail-open for access — read failures
      // should not lock users out).
      const profRow = (profRes?.data ?? null) as { must_change_password?: boolean | null } | null
      mustChangePassword = !!profRow?.must_change_password

      // Seed the shared cache. global_roles/is_super_admin are left empty
      // here — the super-admin branch below will populate them when it
      // actually queries user_global_roles. resolveAuthContext on the API
      // side treats missing global_roles as an empty array, which matches
      // the behaviour that existed before the cache.
      setCachedAuth(token, {
        user_id: userId,
        membership_id: m.id,
        store_uuid: m.store_uuid,
        role: role,
        membership_status: "approved",
        global_roles: [],
        is_super_admin: false,
        must_change_password: mustChangePassword,
      })
    } catch {
      return redirectTo(req, "/login")
    }
  }

  // 4b. Forced password change gate (invite-flow round).
  //     When `profiles.must_change_password === true`, every protected
  //     page request is redirected to /reset-password?force=1 — EXCEPT
  //     the reset flow itself, /login, and /logout, which would trap
  //     the user otherwise. The page completes the change via
  //     POST /api/auth/change-password (cookie-authenticated admin API
  //     call) which flips the flag back to false.
  if (mustChangePassword) {
    const onResetPage =
      pathname === "/reset-password" ||
      pathname.startsWith("/reset-password/")
    const onAuthPage = pathname === "/login" || pathname === "/logout"
    if (!onResetPage && !onAuthPage) {
      const url = req.nextUrl.clone()
      url.pathname = "/reset-password"
      url.searchParams.set("force", "1")
      return NextResponse.redirect(url)
    }
  }

  // 4c. Invite-flow carve-out: `/admin/members/invite` accepts BOTH
  //     owner (for own-store invites) AND super_admin (for any store).
  //     Evaluated BEFORE the hostess redirect and BEFORE the strict
  //     OWNER_ONLY check on `/admin`, so that a super_admin whose primary
  //     membership happens to be hostess/manager/staff (not owner) is not
  //     rejected. The API enforces the same matrix server-side; this
  //     block only gates the UI page.
  if (matchesPrefix(pathname, SUPER_ADMIN_OR_OWNER_PREFIXES)) {
    if (role === "owner") {
      return NextResponse.next()
    }
    let carveSuperAdmin = false
    if (cached && cached.is_super_admin) {
      carveSuperAdmin = true
    } else {
      try {
        const sb = supabase ?? getServiceClient()
        const { data: gr } = await sb
          .from("user_global_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .eq("status", "approved")
          .is("deleted_at", null)
          .limit(1)
        carveSuperAdmin = !!(gr && gr.length > 0)
      } catch {
        carveSuperAdmin = false
      }
    }
    if (carveSuperAdmin) {
      return NextResponse.next()
    }
    // Not owner, not super_admin → role-appropriate redirect. manager
    // and hostess/staff/waiter all fall through to here.
    const fallback =
      role === "manager" ? "/manager" :
      role === "hostess" ? "/me" :
      "/counter"
    return redirectTo(req, fallback)
  }

  // 5. super_admin prefix gate — checked BEFORE hostess redirect so that
  //    a super_admin whose primary membership happens to be a hostess record
  //    (rare but legal) can still access /super-admin. The DB lookup is
  //    against `user_global_roles` where `role='super_admin'` and
  //    `status='approved'` and `deleted_at IS NULL`.
  if (matchesPrefix(pathname, SUPER_ADMIN_ONLY_PREFIXES)) {
    let isSuperAdmin = false
    // P0-1: use cached super-admin flag when available. If the earlier
    // cache miss branch ran, `cached` is null here — fall through to the
    // live query. If we hit the cache at the top but never populated
    // is_super_admin, also query (conservative correctness).
    if (cached && cached.is_super_admin) {
      isSuperAdmin = true
    } else {
      try {
        const sb = supabase ?? getServiceClient()
        const { data: gr } = await sb
          .from("user_global_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .eq("status", "approved")
          .is("deleted_at", null)
          .limit(1)
        isSuperAdmin = !!(gr && gr.length > 0)
      } catch {
        isSuperAdmin = false
      }
    }
    if (!isSuperAdmin) {
      // Redirect to the role-appropriate home, NOT /login (user IS
      // authenticated, just lacks global privilege).
      const fallback =
        role === "owner" ? "/owner" :
        role === "manager" ? "/manager" :
        role === "hostess" ? "/me" :
        "/counter"
      return redirectTo(req, fallback)
    }
    // super_admin — allow access to /super-admin without further role checks.
    return NextResponse.next()
  }

  // 6. Hostess never has business-UI access in the matched prefix set.
  //    Any attempt → /me (their dashboard, which is excluded from matcher).
  if (role === "hostess") {
    return redirectTo(req, "/me")
  }

  // 7. Role matrix. OWNER_MANAGER is checked BEFORE OWNER_ONLY so
  //    that more-specific prefixes like "/ops/ble-analytics" are
  //    classified correctly even though they fall under the
  //    owner-only "/ops" tree.
  if (matchesPrefix(pathname, OWNER_MANAGER_PREFIXES)) {
    if (role !== "owner" && role !== "manager") {
      return redirectTo(req, "/counter")
    }
  } else if (matchesPrefix(pathname, OWNER_ONLY_PREFIXES)) {
    if (role !== "owner") {
      return redirectTo(req, "/counter")
    }
  } else if (matchesPrefix(pathname, MANAGER_ONLY_PREFIXES)) {
    if (role !== "manager") {
      return redirectTo(req, "/counter")
    }
  } else if (matchesPrefix(pathname, COUNTER_ROLE_PREFIXES)) {
    if (!COUNTER_ALLOWED_ROLES.includes(role)) {
      return redirectTo(req, "/counter")
    }
  }

  return NextResponse.next()
}

// Matcher inclusion list. Anything not listed here is unaffected —
// /api/*, /_next/*, /login, /signup, /find-id, /reset-password, /me,
// /, favicon, images, etc. all bypass this middleware entirely.
// `:path*` matches zero or more segments, so `/counter/:path*` covers
// both `/counter` and `/counter/<anything>`.
export const config = {
  matcher: [
    "/counter/:path*",
    "/owner/:path*",
    "/admin/:path*",
    "/approvals/:path*",
    "/inventory/:path*",
    "/ops/:path*",
    "/reports/:path*",
    "/audit/:path*",
    "/audit-events/:path*",
    "/operating-days/:path*",
    "/credits/:path*",
    "/payouts/:path*",
    "/attendance/:path*",
    "/transfer/:path*",
    "/staff/:path*",
    "/customers/:path*",
    "/manager/:path*",
    "/super-admin/:path*",
    // Phase 5: mobile monitor tree.
    "/m/monitor/:path*",
    // Phase 6: 공용 진입 라우터. 페이지 자체가 server redirect 을
    // 수행하므로 middleware 는 인증만 확인한 뒤 통과시킨다.
    "/monitor",
    // api-level-enforcement round: bring /api/* into the matcher so the
    // must_change_password gate applies to business APIs, not just page
    // navigation. The middleware function branches on isApiPath(pathname)
    // at the very top and intentionally does NOT run the page auth logic
    // for API requests — it only reads authCache and, on flag=true,
    // returns a JSON 403. Exempt paths (auth/*, cron/*) are passed
    // through immediately. Unauthenticated API calls are passed through
    // to the route so the route's own 401 handling remains authoritative.
    "/api/:path*",
  ],
}
