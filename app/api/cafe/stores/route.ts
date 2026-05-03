import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { CAFE_FLOOR } from "@/lib/building/floors"

/**
 * GET /api/cafe/stores — 카페 매장 목록 (3층). 인증된 누구나 조회 가능.
 *   주문 화면 진입 시 어느 카페에 주문할지 선택용.
 */
export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 카페 = floor=CAFE_FLOOR 인 매장. (현재 stores 에 floor 컬럼 있음)
    const { data, error } = await supabase
      .from("stores")
      .select("id, store_name, floor")
      .eq("floor", CAFE_FLOOR)
      .is("deleted_at", null)
      .order("store_name")
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ stores: data ?? [] })
  } catch (e) {
    return handleRouteError(e, "cafe/stores")
  }
}
