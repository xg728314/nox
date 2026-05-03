import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * POST /api/cafe/credits/[id]/pay — 외상 회수 처리.
 *   body: { paid_method: 'cash'|'card'|'account'|'other', paid_notes? }
 *   외상 paid_at 채우고 cafe_orders.status='delivered' 로 복귀.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner","manager","staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const parsed = await parseJsonBody<{ paid_method?: string; paid_notes?: string | null }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.paid_method || !["cash","card","account","other"].includes(b.paid_method)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "paid_method required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: credit } = await supabase
      .from("cafe_order_credits")
      .select("id, store_uuid, order_id, paid_at")
      .eq("id", id)
      .maybeSingle()
    if (!credit || credit.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    if (credit.paid_at) {
      return NextResponse.json({ error: "ALREADY_PAID" }, { status: 409 })
    }

    await supabase.from("cafe_order_credits").update({
      paid_at: new Date().toISOString(),
      paid_by: auth.membership_id,
      paid_method: b.paid_method,
      paid_notes: b.paid_notes?.trim() || null,
    }).eq("id", id)

    // 주문 status 도 delivered 로 복귀
    await supabase.from("cafe_orders").update({ status: "delivered" }).eq("id", credit.order_id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, "cafe/credits/pay")
  }
}
