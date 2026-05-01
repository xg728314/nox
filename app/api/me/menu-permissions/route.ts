import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import {
  buildMenuMap,
  fetchManagerMenuPermissions,
  MANAGER_MENU_KEYS,
} from "@/lib/auth/managerMenuPermissions"

/**
 * GET /api/me/menu-permissions
 *
 * R-Manager-Permissions (2026-05-01): 본인 (manager) 메뉴 권한 조회.
 *   ManagerBottomNav 가 mount 시 호출 → 권한 OFF 메뉴 hide.
 *   manager role 외에는 빈 응답 (모든 메뉴 ON 가정).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    // manager 외에는 권한 시스템 적용 X (모든 메뉴 ON 가정)
    if (auth.role !== "manager") {
      const allOn = Object.fromEntries(MANAGER_MENU_KEYS.map((k) => [k, true]))
      return NextResponse.json({
        role: auth.role,
        applies: false,
        menu_map: allOn,
      })
    }

    const supabase = supa()
    const permissions = await fetchManagerMenuPermissions(
      supabase,
      auth.store_uuid,
      auth.membership_id,
    )

    return NextResponse.json({
      role: auth.role,
      applies: true,
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
