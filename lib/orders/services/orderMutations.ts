import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { isValidUUID } from "@/lib/validation"
import type { OrderMutationRow } from "@/lib/orders/types"

type LoadOrderSuccess = {
  authContext: AuthContext
  supabase: SupabaseClient
  order: OrderMutationRow
  error?: never
}

type LoadOrderFailure = {
  error: NextResponse
  authContext?: never
  supabase?: never
  order?: never
}

/**
 * Shared order mutation loader — auth, role gate, finalized receipt guard,
 * business day guard, order lookup + store_uuid scope.
 *
 * Extracts `loadOrderForMutation()` from orders/[order_id]/route.ts.
 * Returns the auth context, supabase client, and order row, or an error response.
 */
export async function loadOrderForMutation(
  request: Request,
  order_id: string
): Promise<LoadOrderSuccess | LoadOrderFailure> {
  const authContext = await resolveAuthContext(request)
  if (authContext.role === "hostess") {
    return { error: NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." }, { status: 403 }) }
  }
  if (!order_id || !isValidUUID(order_id)) {
    return { error: NextResponse.json({ error: "BAD_REQUEST", message: "order_id must be a valid UUID." }, { status: 400 }) }
  }

  const svc = createServiceClient()
  if (svc.error) return { error: svc.error }
  const supabase = svc.supabase

  const { data: order, error: oError } = await supabase
    .from("orders")
    .select("id, session_id, store_uuid, item_name, order_type, qty, unit_price")
    .eq("id", order_id)
    .eq("store_uuid", authContext.store_uuid)
    .is("deleted_at", null)
    .maybeSingle()

  if (oError || !order) {
    return { error: NextResponse.json({ error: "ORDER_NOT_FOUND", message: "Order not found." }, { status: 404 }) }
  }

  // finalized 세션 차단
  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("session_id", order.session_id)
    .eq("store_uuid", authContext.store_uuid)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (receipt && receipt.status === "finalized") {
    return { error: NextResponse.json({ error: "ALREADY_FINALIZED", message: "정산이 확정된 세션입니다." }, { status: 409 }) }
  }

  // Business day closure guard
  {
    const { data: sessionBizDay } = await supabase
      .from("room_sessions")
      .select("business_day_id")
      .eq("id", order.session_id)
      .maybeSingle()
    const guard = await assertBusinessDayOpen(supabase, sessionBizDay?.business_day_id ?? null)
    if (guard) return { error: guard }
  }

  return { authContext, supabase, order: order as OrderMutationRow }
}
