import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { cached } from "@/lib/cache/inMemoryTtl"

/**
 * GET /api/cafe/manage/bootstrap — 카페 manage 페이지 + CafeShell 한 번에.
 *
 * 응답:
 *   profile: { store_uuid, store_name, floor }
 *   inbox: { pending, preparing, delivering, credited, today_count, today_gross }
 *   credits_unpaid: { count, total }
 *   chat_unread: number
 *   chat_rooms: 최근 30개 (sidebar 용)
 *   low_stock: 부족 소모품 list
 *   account: 계좌 정보 (있으면)
 *
 * 기존: /profile + /chat/unread + /cafe/orders/inbox + /cafe/credits + /chat/rooms +
 *       /cafe/supplies?low_only=1 + /cafe/account = 7 round-trip
 * 신규: 1 round-trip (병렬 query 7개 server-side).
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase
    const storeUuid = auth.store_uuid

    // 2026-05-02 R-Cafe-Speed v2: 8초 TTL (polling 10초 → 80% cache hit).
    //   mutation 직후 stale 은 다음 polling 사이클에 자연 회복 (~10초 내).
    const cacheKey = `${storeUuid}:${auth.membership_id}`
    return cached("cafe_manage_bootstrap", cacheKey, 8_000, async () => {
      return await fetchBootstrap(supabase, auth.membership_id, storeUuid)
    }).then((data) => NextResponse.json(data, {
      headers: {
        // 클라이언트도 5초 stale-while-revalidate
        "Cache-Control": "private, max-age=5, stale-while-revalidate=10",
      },
    }))
  } catch (e) {
    return handleRouteError(e, "cafe/manage/bootstrap")
  }
}

async function fetchBootstrap(
  supabase: ReturnType<typeof createServiceClient>["supabase"],
  membershipId: string,
  storeUuid: string,
) {
    if (!supabase) throw new Error("no supabase")
    const [storeRes, inboxRes, creditsRes, chatUnreadRes, chatRoomsRes, lowStockRes, accountRes] = await Promise.all([
      supabase.from("stores").select("id, store_name, floor").eq("id", storeUuid).maybeSingle(),
      supabase
        .from("cafe_orders")
        .select("status, subtotal_amount, created_at")
        .eq("cafe_store_uuid", storeUuid)
        .is("deleted_at", null)
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("cafe_order_credits")
        .select("amount, paid_at")
        .eq("store_uuid", storeUuid)
        .is("paid_at", null),
      supabase
        .from("chat_participants")
        .select("unread_count")
        .eq("membership_id", membershipId)
        .eq("store_uuid", storeUuid)
        .is("left_at", null),
      supabase
        .from("chat_rooms")
        .select("id, name, type, last_message_text, last_message_at, room_uuid")
        .eq("store_uuid", storeUuid)
        .eq("is_active", true)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(30),
      supabase
        .from("cafe_supplies")
        .select("id, name, current_stock, min_stock, unit, category")
        .eq("store_uuid", storeUuid)
        .eq("is_active", true)
        .is("deleted_at", null),
      supabase
        .from("cafe_account_info")
        .select("bank_name, account_number, account_holder, is_active")
        .eq("store_uuid", storeUuid)
        .maybeSingle(),
    ])

    // inbox 집계
    type O = { status: string; subtotal_amount: number; created_at: string }
    const orders = (inboxRes.data ?? []) as O[]
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const stat = { pending: 0, preparing: 0, delivering: 0, credited: 0 }
    let todayCount = 0, todayGross = 0
    for (const o of orders) {
      if (o.status === "pending") stat.pending += 1
      else if (o.status === "preparing") stat.preparing += 1
      else if (o.status === "delivering") stat.delivering += 1
      else if (o.status === "credited") stat.credited += 1
      if (new Date(o.created_at) >= todayStart) {
        todayCount += 1
        todayGross += o.subtotal_amount ?? 0
      }
    }

    // credits 집계
    type C = { amount: number; paid_at: string | null }
    const credits = (creditsRes.data ?? []) as C[]
    const unpaidCount = credits.length
    const unpaidTotal = credits.reduce((s, c) => s + (c.amount ?? 0), 0)

    // chat unread
    type CP = { unread_count: number }
    const chatUnread = ((chatUnreadRes.data ?? []) as CP[]).reduce((s, p) => s + (p.unread_count ?? 0), 0)

    // low stock
    type S = { id: string; name: string; current_stock: number; min_stock: number; unit: string; category: string | null }
    const allSupplies = (lowStockRes.data ?? []) as S[]
    const lowStock = allSupplies.filter((s) => Number(s.current_stock) < Number(s.min_stock))

    return {
      profile: {
        store_uuid: storeUuid,
        store_name: storeRes.data?.store_name ?? null,
        floor: storeRes.data?.floor ?? null,
      },
      inbox: {
        ...stat,
        today_count: todayCount,
        today_gross: todayGross,
      },
      credits_unpaid: { count: unpaidCount, total: unpaidTotal },
      chat_unread: chatUnread,
      chat_rooms: chatRoomsRes.data ?? [],
      low_stock: lowStock,
      account: accountRes.data ?? null,
    }
}
