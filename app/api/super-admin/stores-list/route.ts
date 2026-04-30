import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/super-admin/stores-list
 *
 * R-StoreSwitch (2026-05-01 복구):
 *   super_admin 이 멤버십 없는 매장도 cookie override 로 전환 가능 →
 *   owner page 의 "다른 매장으로 전환" 에서 본인 멤버십 매장 + 전체 매장
 *   둘 다 보여야 한다.
 *
 *   /api/auth/memberships 는 본인 row 만 반환 (보안). super_admin 의 경우엔
 *   별도 endpoint 가 모든 매장 list 를 반환해야 함.
 *
 * 가드: super_admin only. 그 외 403.
 *
 * 응답:
 *   { stores: [{ store_uuid, store_name, floor_no }, ...] }
 *   deleted_at IS NULL active 매장만.
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
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "super_admin only" },
        { status: 403 },
      )
    }

    const supabase = supa()
    const { data, error } = await supabase
      .from("stores")
      .select("id, store_name, floor_no")
      .is("deleted_at", null)
      .order("floor_no", { ascending: true, nullsFirst: false })
      .order("store_name", { ascending: true })

    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }

    return NextResponse.json({
      stores: (data ?? []).map((s) => ({
        store_uuid: s.id,
        store_name: s.store_name,
        floor_no: s.floor_no,
      })),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
