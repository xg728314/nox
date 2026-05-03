import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { CAFE_FLOOR } from "@/lib/building/floors"

/**
 * GET /api/cafe/admin/overview — super_admin 전용. 모든 카페 매장의
 *   메뉴 수 / 주문 통계 (오늘 / 진행 중 / 완료 / 취소) / 계좌 등록 여부 한눈에.
 *
 *   xg728314 같은 운영자가 카페까지 들여다보는 경로.
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: cafes } = await supabase
      .from("stores")
      .select("id, store_name, floor")
      .eq("floor", CAFE_FLOOR)
      .is("deleted_at", null)
      .order("store_name")
    const cafeList = (cafes ?? []) as Array<{ id: string; store_name: string; floor: number }>
    if (cafeList.length === 0) return NextResponse.json({ cafes: [] })

    const cafeIds = cafeList.map((c) => c.id)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayIso = todayStart.toISOString()

    const [menuRes, orderTotalRes, orderTodayRes, accountRes] = await Promise.all([
      supabase
        .from("cafe_menu_items")
        .select("store_uuid")
        .in("store_uuid", cafeIds)
        .is("deleted_at", null)
        .eq("is_active", true),
      supabase
        .from("cafe_orders")
        .select("cafe_store_uuid, status")
        .in("cafe_store_uuid", cafeIds)
        .is("deleted_at", null),
      supabase
        .from("cafe_orders")
        .select("cafe_store_uuid, subtotal_amount, status")
        .in("cafe_store_uuid", cafeIds)
        .is("deleted_at", null)
        .gte("created_at", todayIso),
      supabase
        .from("cafe_account_info")
        .select("store_uuid, is_active, account_number")
        .in("store_uuid", cafeIds),
    ])

    const menuCount = new Map<string, number>()
    for (const m of (menuRes.data ?? []) as Array<{ store_uuid: string }>) {
      menuCount.set(m.store_uuid, (menuCount.get(m.store_uuid) ?? 0) + 1)
    }

    type StatusBucket = { pending: number; preparing: number; delivering: number; delivered: number; cancelled: number }
    function emptyBucket(): StatusBucket {
      return { pending: 0, preparing: 0, delivering: 0, delivered: 0, cancelled: 0 }
    }
    const allTimeStats = new Map<string, StatusBucket>()
    for (const o of (orderTotalRes.data ?? []) as Array<{ cafe_store_uuid: string; status: keyof StatusBucket }>) {
      const b = allTimeStats.get(o.cafe_store_uuid) ?? emptyBucket()
      b[o.status] = (b[o.status] ?? 0) + 1
      allTimeStats.set(o.cafe_store_uuid, b)
    }
    const todayStats = new Map<string, { count: number; gross: number; delivered: number }>()
    for (const o of (orderTodayRes.data ?? []) as Array<{ cafe_store_uuid: string; subtotal_amount: number; status: string }>) {
      const r = todayStats.get(o.cafe_store_uuid) ?? { count: 0, gross: 0, delivered: 0 }
      r.count += 1
      r.gross += o.subtotal_amount
      if (o.status === "delivered") r.delivered += 1
      todayStats.set(o.cafe_store_uuid, r)
    }
    const accounts = new Map<string, { is_active: boolean; has_number: boolean }>()
    for (const a of (accountRes.data ?? []) as Array<{ store_uuid: string; is_active: boolean; account_number: string | null }>) {
      accounts.set(a.store_uuid, { is_active: a.is_active, has_number: !!a.account_number })
    }

    const result = cafeList.map((c) => ({
      ...c,
      menu_active: menuCount.get(c.id) ?? 0,
      account: accounts.get(c.id) ?? { is_active: false, has_number: false },
      all_time: allTimeStats.get(c.id) ?? emptyBucket(),
      today: todayStats.get(c.id) ?? { count: 0, gross: 0, delivered: 0 },
    }))
    return NextResponse.json({ cafes: result })
  } catch (e) {
    return handleRouteError(e, "cafe/admin/overview")
  }
}
