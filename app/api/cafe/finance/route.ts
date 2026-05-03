import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * GET /api/cafe/finance?days=30 — 카페 재무 요약.
 *   카페 owner 본인 매장 (또는 super_admin + ?store_uuid=X).
 *   기본 30일치. 일별 매출 / 결제수단별 / 메뉴 top.
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const reqStore = url.searchParams.get("store_uuid")
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? "30")))

    let scopeStore: string
    if (auth.is_super_admin && reqStore) {
      scopeStore = reqStore
    } else {
      if (!["owner", "manager", "staff"].includes(auth.role)) {
        return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
      }
      scopeStore = auth.store_uuid
    }

    const since = new Date(Date.now() - days * 86400_000)
    const sinceIso = since.toISOString()

    const svc = createServiceClient()
    if (svc.error) return svc.error

    const { data: orders, error } = await svc.supabase
      .from("cafe_orders")
      .select("id, items, subtotal_amount, payment_method, status, paid_at, delivered_at, created_at")
      .eq("cafe_store_uuid", scopeStore)
      .gte("created_at", sinceIso)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })

    const list = (orders ?? []) as Array<{
      id: string; items: Array<{ name: string; price: number; qty: number; menu_id: string }>;
      subtotal_amount: number; payment_method: string; status: string;
      paid_at: string | null; delivered_at: string | null; created_at: string
    }>

    // 일별 매출 (delivered 또는 paid 만 — 취소 제외)
    const daily: Record<string, { count: number; gross: number; delivered: number }> = {}
    // 결제수단별
    const byMethod: Record<string, { count: number; gross: number; paid: number }> = {
      account: { count: 0, gross: 0, paid: 0 },
      card_on_delivery: { count: 0, gross: 0, paid: 0 },
    }
    // 메뉴별 top
    const menuStats = new Map<string, { name: string; qty: number; gross: number }>()

    let totalDelivered = 0
    let totalGross = 0
    let totalCancelled = 0
    let unpaidAccount = 0  // 입금 미확인

    for (const o of list) {
      const dateKey = o.created_at.slice(0, 10)
      const dayBucket = daily[dateKey] ??= { count: 0, gross: 0, delivered: 0 }
      dayBucket.count += 1
      if (o.status === "delivered") {
        dayBucket.gross += o.subtotal_amount
        dayBucket.delivered += 1
        totalDelivered += 1
        totalGross += o.subtotal_amount

        for (const it of o.items ?? []) {
          const cur = menuStats.get(it.menu_id) ?? { name: it.name, qty: 0, gross: 0 }
          cur.qty += it.qty
          cur.gross += it.price * it.qty
          menuStats.set(it.menu_id, cur)
        }
      }
      if (o.status === "cancelled") totalCancelled += 1

      const m = byMethod[o.payment_method] ?? { count: 0, gross: 0, paid: 0 }
      m.count += 1
      if (o.status === "delivered") m.gross += o.subtotal_amount
      if (o.payment_method === "account" && o.paid_at) m.paid += o.subtotal_amount
      byMethod[o.payment_method] = m

      if (o.payment_method === "account" && o.status !== "cancelled" && !o.paid_at) {
        unpaidAccount += o.subtotal_amount
      }
    }

    const dailySorted = Object.entries(daily)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const topMenu = Array.from(menuStats.values())
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 10)

    return NextResponse.json({
      days, since: sinceIso,
      totals: {
        orders: list.length,
        delivered: totalDelivered,
        cancelled: totalCancelled,
        gross: totalGross,
        unpaid_account: unpaidAccount,
      },
      by_method: byMethod,
      daily: dailySorted,
      top_menu: topMenu,
    })
  } catch (e) {
    return handleRouteError(e, "cafe/finance")
  }
}
