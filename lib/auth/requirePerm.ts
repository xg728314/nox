/**
 * lib/auth/requirePerm.ts
 *
 * R33 (2026-09-04): API route 에서 permission 게이트 적용 헬퍼.
 *
 * 사용법:
 *
 *   import { requirePerm } from "@/lib/auth/requirePerm"
 *   import { PERMS } from "@/lib/auth/permissions"
 *
 *   export async function POST(request: Request) {
 *     const gate = await requirePerm(request, PERMS.SETTLE_MANAGE)
 *     if (gate.error) return gate.error
 *     const auth = gate.auth
 *     // ... business logic
 *   }
 *
 * 정책:
 *   - resolveAuthContext + role='hostess' 는 항상 거부
 *   - role='owner' + super_admin 은 항상 통과 (전권)
 *   - role='manager' 는 store_memberships.permissions 조회 후 판정
 *   - permissions == NULL → DEFAULT_MANAGER_PERMS 적용
 *   - permission 없으면 403 PERMISSION_DENIED
 *
 * 캐시: 이 헬퍼 자체는 캐시 안 함 (route 별로 호출 시 fresh 조회).
 *   같은 라우트에서 여러 permission 체크 필요하면 아래 loadPermissions 를
 *   한 번 호출 후 hasPerm 여러 번 로컬로 체크.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError, type AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import {
  effectivePermissions,
  hasPerm,
  type PermKey,
  type PermissionMap,
} from "@/lib/auth/permissions"

/** loadPermissions — auth 로부터 실효 permission map 조회 */
export async function loadPermissions(auth: AuthContext): Promise<Record<PermKey, boolean>> {
  if (auth.role === "owner" || auth.is_super_admin) {
    // effectivePermissions 가 owner 를 전권으로 처리
    return effectivePermissions("owner", null)
  }
  if (auth.role !== "manager") {
    return effectivePermissions(auth.role, null) // hostess/waiter/staff → 빈 map
  }
  const sb = getServiceClient()
  const { data } = await sb.from("store_memberships")
    .select("permissions")
    .eq("id", auth.membership_id)
    .maybeSingle()
  const raw = (data as { permissions?: PermissionMap | null } | null)?.permissions ?? null
  return effectivePermissions("manager", raw)
}

/**
 * requirePerm — 하나의 permission 을 요구하는 gate.
 *   반환: { auth, perms } 또는 { error: NextResponse }
 */
export async function requirePerm(
  request: Request,
  perm: PermKey,
): Promise<
  | { auth: AuthContext; perms: Record<PermKey, boolean>; error?: undefined }
  | { auth?: undefined; perms?: undefined; error: NextResponse }
> {
  try {
    const auth = await resolveAuthContext(request)
    const perms = await loadPermissions(auth)
    if (!hasPerm(perms, perm)) {
      return {
        error: NextResponse.json(
          { error: "PERMISSION_DENIED", message: `필요한 권한 없음: ${perm}`, required: perm },
          { status: 403 },
        ),
      }
    }
    return { auth, perms }
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: NextResponse.json({ error: e.type, message: e.message }, { status: e.status }) }
    }
    return {
      error: NextResponse.json(
        { error: "INTERNAL_ERROR", message: (e as Error).message },
        { status: 500 },
      ),
    }
  }
}

/**
 * ensurePerm — resolveAuthContext 를 이미 호출한 후 permission 체크.
 *
 * 기존 route 의 role gate 뒤에 삽입:
 *
 *   const auth = await resolveAuthContext(request)
 *   if (auth.role === "hostess") return ROLE_FORBIDDEN
 *   const permErr = await ensurePerm(auth, PERMS.SETTLE_MANAGE)
 *   if (permErr) return permErr
 *
 * 반환: null (통과) or NextResponse (403).
 * owner + super_admin 은 항상 null.
 */
export async function ensurePerm(auth: AuthContext, perm: PermKey): Promise<NextResponse | null> {
  if (auth.role === "owner" || auth.is_super_admin) return null
  if (auth.role !== "manager") {
    return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "manager or owner required" }, { status: 403 })
  }
  const perms = await loadPermissions(auth)
  if (!hasPerm(perms, perm)) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", message: `필요한 권한 없음: ${perm}`, required: perm },
      { status: 403 },
    )
  }
  return null
}

/**
 * requireAnyPerm — 여러 permission 중 하나라도 있으면 통과.
 *   view + manage 같이 계층형 접근 시 사용.
 */
export async function requireAnyPerm(
  request: Request,
  perms: PermKey[],
): Promise<
  | { auth: AuthContext; perms: Record<PermKey, boolean>; error?: undefined }
  | { auth?: undefined; perms?: undefined; error: NextResponse }
> {
  try {
    const auth = await resolveAuthContext(request)
    const permMap = await loadPermissions(auth)
    if (!perms.some(p => hasPerm(permMap, p))) {
      return {
        error: NextResponse.json(
          { error: "PERMISSION_DENIED", message: `필요한 권한 없음: ${perms.join(" or ")}`, required: perms },
          { status: 403 },
        ),
      }
    }
    return { auth, perms: permMap }
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: NextResponse.json({ error: e.type, message: e.message }, { status: e.status }) }
    }
    return {
      error: NextResponse.json(
        { error: "INTERNAL_ERROR", message: (e as Error).message },
        { status: 500 },
      ),
    }
  }
}
