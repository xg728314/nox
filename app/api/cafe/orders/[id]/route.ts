import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import type { CafeOrderStatus } from "@/lib/cafe/types"

/**
 * PATCH /api/cafe/orders/[id] — 주문 상태 변경.
 *
 * 권한:
 *   - 카페 owner/manager/staff: 자기 매장으로 들어온 주문만. status 모든 전이 가능.
 *     paid_at 마킹 (계좌 입금 확인) 도 카페 측이 함.
 *   - 주문자 (customer): 자기 주문만. status='cancelled' 전이만 (그것도 pending 상태일 때만).
 *
 * 상태 전이:
 *   pending → preparing → delivering → delivered
 *   pending → cancelled (주문자 자가 취소)
 *   pending → cancelled (카페 거절)
 */

const VALID_STATUSES: CafeOrderStatus[] = ["pending", "preparing", "delivering", "delivered", "cancelled"]

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const parsed = await parseJsonBody<{
      status?: CafeOrderStatus
      mark_paid?: boolean
      notes?: string | null
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: order } = await supabase
      .from("cafe_orders")
      .select("id, cafe_store_uuid, customer_membership_id, status, payment_method")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

    const isCafeStaff =
      ["owner", "manager", "staff"].includes(auth.role) &&
      auth.store_uuid === order.cafe_store_uuid
    const isCustomer = auth.membership_id === order.customer_membership_id

    if (!isCafeStaff && !isCustomer) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const patch: Record<string, unknown> = {}

    if (b.status) {
      if (!VALID_STATUSES.includes(b.status)) {
        return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 })
      }
      // customer 는 pending 상태에서만 cancelled 가능
      if (isCustomer && !isCafeStaff) {
        if (b.status !== "cancelled" || order.status !== "pending") {
          return NextResponse.json({ error: "CUSTOMER_CANCEL_ONLY_PENDING" }, { status: 403 })
        }
      }
      patch.status = b.status
      if (b.status === "delivered") {
        patch.delivered_at = new Date().toISOString()
        if (isCafeStaff) patch.delivered_by = auth.membership_id
      }
    }

    if (b.mark_paid === true) {
      if (!isCafeStaff) {
        return NextResponse.json({ error: "CAFE_STAFF_ONLY_FOR_PAID" }, { status: 403 })
      }
      if (order.payment_method !== "account") {
        return NextResponse.json({ error: "PAID_ONLY_FOR_ACCOUNT" }, { status: 400 })
      }
      patch.paid_at = new Date().toISOString()
    }

    if (typeof b.notes === "string" && isCafeStaff) {
      patch.notes = b.notes.trim() || null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "NO_PATCH" }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from("cafe_orders")
      .update(patch)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id, status, paid_at, delivered_at")
      .maybeSingle()
    if (error) return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    if (!updated) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ order: updated })
  } catch (e) {
    return handleRouteError(e, "cafe/orders/[id]")
  }
}
