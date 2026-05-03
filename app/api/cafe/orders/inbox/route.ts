import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * GET /api/cafe/orders/inbox — 카페가 받은 주문 목록.
 *   - 카페 owner/manager/staff: 본인 매장만 (auth.store_uuid scope).
 *   - super_admin: ?store_uuid=X 파라미터로 임의 카페 조회 가능.
 *   ?status=pending|preparing|delivering|delivered|cancelled (선택)
 *   기본: pending+preparing+delivering (작업 중)
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const requestedStore = url.searchParams.get("store_uuid")

    let scopeStore: string
    if (auth.is_super_admin && requestedStore) {
      // super_admin 가 다른 카페 들여다볼 때
      scopeStore = requestedStore
    } else {
      if (!["owner", "manager", "staff"].includes(auth.role)) {
        return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
      }
      scopeStore = auth.store_uuid
    }

    const filterStatus = url.searchParams.get("status")
    const statuses = filterStatus
      ? [filterStatus]
      : ["pending", "preparing", "delivering"]

    const svc = createServiceClient()
    if (svc.error) return svc.error

    const { data, error } = await svc.supabase
      .from("cafe_orders")
      .select(`
        id, customer_store_uuid, customer_membership_id,
        delivery_room_uuid, delivery_session_id, delivery_text,
        items, subtotal_amount, payment_method, status,
        paid_at, delivered_at, delivered_by, notes,
        created_at, updated_at
      `)
      .eq("cafe_store_uuid", scopeStore)
      .in("status", statuses)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })

    const rows = data ?? []
    if (rows.length === 0) return NextResponse.json({ orders: [] })

    // enrich: customer_store_name, customer_name, room_name
    const customerStoreIds = Array.from(new Set(rows.map((r) => r.customer_store_uuid)))
    const customerMids = Array.from(new Set(rows.map((r) => r.customer_membership_id)))
    const roomIds = Array.from(new Set(rows.map((r) => r.delivery_room_uuid).filter(Boolean) as string[]))

    const [storesRes, profilesRes, roomsRes] = await Promise.all([
      svc.supabase.from("stores").select("id, store_name").in("id", customerStoreIds),
      svc.supabase
        .from("store_memberships")
        .select("id, profile_id")
        .in("id", customerMids)
        .then(async (r) => {
          const pids = (r.data ?? []).map((x) => x.profile_id).filter(Boolean) as string[]
          if (pids.length === 0) return { mems: r.data ?? [], profiles: [] as Array<{ id: string; full_name: string | null }> }
          const { data: profs } = await svc.supabase
            .from("profiles").select("id, full_name").in("id", pids)
            .then((p) => ({ data: (p.data ?? []) as Array<{ id: string; full_name: string | null }> }))
          return { mems: r.data ?? [], profiles: profs }
        }),
      roomIds.length > 0
        ? svc.supabase.from("rooms").select("id, room_name, room_no").in("id", roomIds)
        : Promise.resolve({ data: [] as Array<{ id: string; room_name: string | null; room_no: string }> }),
    ])

    const storeNameById = new Map<string, string>()
    for (const s of (storesRes.data ?? []) as Array<{ id: string; store_name: string }>) {
      storeNameById.set(s.id, s.store_name)
    }
    const memToProfile = new Map<string, string>()
    for (const m of profilesRes.mems as Array<{ id: string; profile_id: string | null }>) {
      if (m.profile_id) memToProfile.set(m.id, m.profile_id)
    }
    const profileName = new Map<string, string>()
    for (const p of profilesRes.profiles) {
      if (p.full_name) profileName.set(p.id, p.full_name)
    }
    const roomNameById = new Map<string, string>()
    for (const r of (roomsRes.data ?? []) as Array<{ id: string; room_name: string | null; room_no: string }>) {
      roomNameById.set(r.id, r.room_name || `${r.room_no}번방`)
    }

    const enriched = rows.map((r) => ({
      ...r,
      customer_store_name: storeNameById.get(r.customer_store_uuid) ?? null,
      customer_name: profileName.get(memToProfile.get(r.customer_membership_id) ?? "") ?? null,
      delivery_room_name: r.delivery_room_uuid ? (roomNameById.get(r.delivery_room_uuid) ?? null) : null,
    }))
    return NextResponse.json({ orders: enriched })
  } catch (e) {
    return handleRouteError(e, "cafe/orders/inbox")
  }
}
