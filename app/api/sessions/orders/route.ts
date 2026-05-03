import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { validateCreateOrderInput, validatePriceGuard } from "@/lib/orders/services/validateOrder"
import { decrementStock } from "@/lib/orders/services/inventoryOps"
import { archivedAtFilter } from "@/lib/session/archivedFilter"
import { cached, invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"
import type { OrderListRow } from "@/lib/orders/types"

// 2026-05-03 R-Speed-x10: 카운터 폴링이 매 5초마다 호출. TTL 캐시 + SWR.
const ORDERS_TTL_MS = 3000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const session_id = searchParams.get("session_id")

    if (!session_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id query parameter is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-03 R-Speed-x10: TTL 캐시 + SWR + 브라우저 max-age=2.
    //   같은 session 의 polling cycle 안 hit 즉시 반환 (~5ms).
    //   POST/DELETE 시 invalidate 호출.
    const cacheKey = `${authContext.store_uuid}:${session_id}`
    const data = await cached(
      "session_orders",
      cacheKey,
      ORDERS_TTL_MS,
      async () => {
        const applyArchivedNull = await archivedAtFilter(supabase, "orders")
        const [sessionRes, ordersRes] = await Promise.all([
          supabase
            .from("room_sessions")
            .select("id")
            .eq("id", session_id)
            .eq("store_uuid", authContext.store_uuid)
            .maybeSingle(),
          applyArchivedNull(
            supabase
              .from("orders")
              .select("id, session_id, item_name, order_type, qty, unit_price, store_price, sale_price, manager_amount, customer_amount, ordered_by, created_at")
              .eq("store_uuid", authContext.store_uuid)
              .eq("session_id", session_id)
              .is("deleted_at", null)
          ).order("created_at", { ascending: true }),
        ])

        if (!sessionRes.data) {
          throw new Error("SESSION_NOT_FOUND")
        }
        if (ordersRes.error) {
          throw new Error("QUERY_FAILED")
        }
        const orders = ordersRes.data

        return {
          session_id,
          orders: (orders ?? []).map((o: OrderListRow) => ({
            id: o.id,
            session_id: o.session_id,
            item_name: o.item_name,
            order_type: o.order_type,
            qty: o.qty,
            unit_price: o.unit_price,
            store_price: o.store_price,
            sale_price: o.sale_price,
            amount: o.customer_amount,
            manager_amount: o.manager_amount,
            customer_amount: o.customer_amount,
            ordered_by: o.ordered_by,
            created_at: o.created_at,
          })),
        }
      },
    ).catch((e) => {
      const msg = e instanceof Error ? e.message : "QUERY_FAILED"
      if (msg === "SESSION_NOT_FOUND") {
        return { __error: { status: 404, code: "SESSION_NOT_FOUND", message: "Session not found in this store." } }
      }
      return { __error: { status: 500, code: "QUERY_FAILED", message: "Failed to query orders." } }
    })

    if ("__error" in data && data.__error) {
      return NextResponse.json(
        { error: data.__error.code, message: data.__error.message },
        { status: data.__error.status },
      )
    }

    const res = NextResponse.json(data)
    res.headers.set("Cache-Control", "private, max-age=2, stale-while-revalidate=5")
    return res
  } catch (error) {
    return handleRouteError(error, "orders")
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only, hostess forbidden
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to add orders." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      item_name?: string
      order_type?: string
      qty?: number
      unit_price?: number
      sale_price?: number
      inventory_item_id?: string | null
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, item_name, order_type, qty, unit_price, sale_price, inventory_item_id } = parsed.body

    // Input validation
    const validationError = validateCreateOrderInput({ session_id, item_name, order_type, qty, unit_price })
    if (validationError) return validationError

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-03 R-Speed-x10: session 검증 + business_day 검증 병렬화.
    //   기존: session (1 RTT) → business_day (1 RTT) 직렬.
    //   현재: 둘 다 동시 fire — store 의 가장 최근 2개 영업일을 미리 가져와서
    //   session.business_day_id 와 매칭되면 즉시 사용. 1 RTT 절감.
    const [sessionRes, bizDayRes] = await Promise.all([
      supabase
        .from("room_sessions")
        .select("id, store_uuid, business_day_id, status")
        .eq("id", session_id!)
        .maybeSingle(),
      supabase
        .from("store_operating_days")
        .select("id, status")
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .order("business_date", { ascending: false })
        .limit(2),
    ])

    const { data: session, error: sessionError } = sessionRes
    if (sessionError || !session) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found." },
        { status: 404 }
      )
    }
    if (session.status !== "active") {
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: "Session is not active." },
        { status: 400 }
      )
    }
    if (session.store_uuid !== authContext.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Session does not belong to your store." },
        { status: 403 }
      )
    }
    if (!session.business_day_id) {
      return NextResponse.json(
        { error: "BUSINESS_DAY_NOT_FOUND", message: "Session has no business_day_id. Cannot create order." },
        { status: 400 }
      )
    }

    // business_day 상태 — Promise.all 결과 우선 매칭, 없으면 fallback 1회 fetch.
    const bizDays = (bizDayRes.data ?? []) as Array<{ id: string; status: string }>
    const matched = bizDays.find((d) => d.id === session.business_day_id)
    let bizDayStatus = matched?.status ?? null
    if (!matched) {
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("status")
        .eq("id", session.business_day_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      bizDayStatus = bizDay?.status ?? null
    }
    if (bizDayStatus === "closed") {
      return NextResponse.json(
        { error: "BUSINESS_DAY_CLOSED", message: "영업일이 마감되었습니다. 주문을 추가할 수 없습니다." },
        { status: 403 }
      )
    }

    // 4. Determine dual pricing
    let resolvedStorePrice = unit_price!
    let resolvedSalePrice = sale_price ?? unit_price!

    // 5. If inventory_item_id provided, atomic stock decrement
    if (inventory_item_id) {
      const result = await decrementStock(supabase, {
        inventory_item_id,
        store_uuid: authContext.store_uuid,
        qty: qty!,
        item_name: item_name!,
        session_id: session_id!,
        business_day_id: session.business_day_id,
        membership_id: authContext.membership_id,
      })
      if (result.error) return result.error
      resolvedStorePrice = result.resolvedStorePrice
    }

    // 6. Price guard: sale_price must be >= store_price
    const priceError = validatePriceGuard(resolvedSalePrice, resolvedStorePrice)
    if (priceError) return priceError

    // 7. Compute amounts
    const computedManagerAmount = (resolvedSalePrice - resolvedStorePrice) * qty!
    const computedCustomerAmount = resolvedSalePrice * qty!

    // 8. INSERT order with dual pricing
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        session_id: session_id!,
        store_uuid: authContext.store_uuid,
        business_day_id: session.business_day_id,
        item_name: item_name!,
        order_type: order_type!,
        qty: qty!,
        unit_price: resolvedSalePrice,
        store_price: resolvedStorePrice,
        sale_price: resolvedSalePrice,
        manager_amount: computedManagerAmount,
        customer_amount: computedCustomerAmount,
        inventory_item_id: inventory_item_id || null,
        ordered_by: authContext.user_id,
      })
      .select("id, session_id, item_name, order_type, qty, unit_price, store_price, sale_price, manager_amount, customer_amount, ordered_by")
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: "ORDER_CREATE_FAILED", message: "Failed to create order." },
        { status: 500 }
      )
    }

    // 2026-05-03 R-Speed-x10: orders 캐시 무효화 (POST 후 다음 GET 즉시 fresh).
    invalidateCache("session_orders")

    // 9. Record audit event — 2026-05-01 R-Counter-Speed: background fire.
    //   await 차단 제거 → 응답 latency 100-200ms 단축.
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id: session_id!,
      entity_table: "orders",
      entity_id: order.id,
      action: "order_added",
      after: {
        item_name: item_name!,
        order_type: order_type!,
        qty: qty!,
        store_price: resolvedStorePrice,
        sale_price: resolvedSalePrice,
        manager_amount: computedManagerAmount,
        customer_amount: computedCustomerAmount,
        inventory_item_id: inventory_item_id || null,
        ordered_by: authContext.user_id,
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[orders] audit write failed:", e instanceof Error ? e.message : e)
    })

    return NextResponse.json(
      {
        order_id: order.id,
        session_id: order.session_id,
        item_name: order.item_name,
        order_type: order.order_type,
        qty: order.qty,
        unit_price: order.unit_price,
        store_price: order.store_price,
        sale_price: order.sale_price,
        amount: order.customer_amount,
        manager_amount: order.manager_amount,
        customer_amount: order.customer_amount,
        ordered_by: order.ordered_by,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "orders")
  }
}
