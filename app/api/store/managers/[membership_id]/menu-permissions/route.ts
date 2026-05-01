import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import {
  buildMenuMap,
  fetchManagerMenuPermissions,
  saveManagerMenuPermissions,
  MANAGER_MENU_KEYS,
} from "@/lib/auth/managerMenuPermissions"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * GET / PUT /api/store/managers/[membership_id]/menu-permissions
 *
 * R-Manager-Permissions (2026-05-01):
 *   - GET: 사장이 특정 실장의 메뉴 권한 조회 (default ON 반영).
 *   - PUT: 사장이 토글 변경 저장. body { permissions: {key: boolean} }.
 *
 * 권한:
 *   GET / PUT — owner / super_admin only.
 *   본인 매장 실장만 (target membership.store_uuid = auth.store_uuid).
 *   본인 자신 (auth.membership_id) 변경 불가 — 자기 권한 잠그면 lockout.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

async function checkOwnerAndTarget(
  supabase: ReturnType<typeof supa>,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  membership_id: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  if (auth.role !== "owner" && !auth.is_super_admin) {
    return { ok: false, status: 403, error: "ROLE_FORBIDDEN", message: "사장만 가능합니다." }
  }
  if (membership_id === auth.membership_id) {
    return {
      ok: false,
      status: 400,
      error: "SELF_LOCKOUT",
      message: "본인 권한은 본 메뉴에서 변경할 수 없습니다.",
    }
  }
  // target 매장 검증
  const { data: m } = await supabase
    .from("store_memberships")
    .select("id, store_uuid, role, status")
    .eq("id", membership_id)
    .maybeSingle()
  if (!m) return { ok: false, status: 404, error: "NOT_FOUND", message: "실장을 찾을 수 없습니다." }
  const row = m as { id: string; store_uuid: string; role: string; status: string }
  if (row.store_uuid !== auth.store_uuid) {
    return {
      ok: false,
      status: 403,
      error: "STORE_FORBIDDEN",
      message: "본인 매장 실장만 관리할 수 있습니다.",
    }
  }
  if (row.role !== "manager") {
    return {
      ok: false,
      status: 400,
      error: "NOT_MANAGER",
      message: "manager role 만 메뉴 권한을 가집니다.",
    }
  }
  return { ok: true }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ membership_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id } = await context.params
    const supabase = supa()

    const check = await checkOwnerAndTarget(supabase, auth, membership_id)
    if (!check.ok) {
      return NextResponse.json({ error: check.error, message: check.message }, { status: check.status })
    }

    const permissions = await fetchManagerMenuPermissions(supabase, auth.store_uuid, membership_id)
    return NextResponse.json({
      membership_id,
      menu_keys: MANAGER_MENU_KEYS,
      permissions,
      menu_map: buildMenuMap(permissions),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ membership_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id } = await context.params
    const supabase = supa()

    const check = await checkOwnerAndTarget(supabase, auth, membership_id)
    if (!check.ok) {
      return NextResponse.json({ error: check.error, message: check.message }, { status: check.status })
    }

    const body = (await request.json().catch(() => ({}))) as {
      permissions?: Record<string, unknown>
    }
    if (!body.permissions || typeof body.permissions !== "object") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "permissions object required" }, { status: 400 })
    }

    // 알려진 key 만 + boolean 만 필터.
    const filtered: Record<string, boolean> = {}
    for (const k of MANAGER_MENU_KEYS) {
      const v = body.permissions[k]
      if (typeof v === "boolean") filtered[k] = v
    }

    const saved = await saveManagerMenuPermissions(supabase, {
      store_uuid: auth.store_uuid,
      membership_id,
      permissions: filtered,
      updated_by_user_id: auth.user_id,
      updated_by_membership_id: auth.membership_id,
    })
    if (!saved.ok) {
      return NextResponse.json({ error: "SAVE_FAILED", message: saved.error }, { status: 500 })
    }

    try {
      await logAuditEvent(supabase, {
        auth,
        action: "manager_menu_permissions_updated",
        entity_table: "store_memberships",
        entity_id: membership_id,
        metadata: { permissions: filtered },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({
      ok: true,
      permissions: filtered,
      menu_map: buildMenuMap(filtered),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
