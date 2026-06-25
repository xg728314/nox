/**
 * /api/manager/staff-payout/[hostess_id]
 *
 * 식구별 영업일 정산 상태 (정산완료 / 보관 / 팁) 조회·갱신.
 *
 * 동일 (store, business_day, hostess) 1 row — upsert 패턴.
 *
 * GET:
 *   {
 *     state: { status, base_amount, tip_amount, tip_held_amount, held_amount,
 *              paid_amount, paid_method, memo, updated_at } | null,
 *     today_gross: number,    // session_participants 합계 (참고)
 *     today_hostess_payout: number,
 *     today_count: number,
 *   }
 *
 * PATCH body (모두 optional — 부분 갱신):
 *   {
 *     status?: 'pending' | 'paid' | 'held',
 *     tip_amount?: number,
 *     tip_held_amount?: number,
 *     held_amount?: number,
 *     paid_amount?: number,
 *     paid_method?: 'cash' | 'account',
 *     memo?: string,
 *   }
 *
 * 권한: owner / manager (manager 는 본인 담당 식구만).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { isValidUUID } from "@/lib/validation"

async function getBizDayId(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
): Promise<string | null> {
  const today = getBusinessDateForOps()
  const { data } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("business_date", today)
    .maybeSingle()
  return data?.id ?? null
}

async function assertManagerCanView(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
  managerMid: string,
  hostessMid: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("hostesses")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("manager_membership_id", managerMid)
    .eq("membership_id", hostessMid)
    .maybeSingle()
  return !!data
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    if (auth.role === "manager") {
      const ok = await assertManagerCanView(supabase, auth.store_uuid, auth.membership_id, hostess_id)
      if (!ok) return NextResponse.json({ error: "NOT_ASSIGNED" }, { status: 403 })
    }

    const businessDayId = await getBizDayId(supabase, auth.store_uuid)
    if (!businessDayId) {
      return NextResponse.json({ state: null, today_gross: 0, today_hostess_payout: 0, today_count: 0 })
    }

    // session_participants 합계 (참고용 — 식구의 본 매장 + 본 매장 식구가 타매장에서 일한 거 모두)
    const { data: parts } = await supabase
      .from("session_participants")
      .select("price_amount, hostess_payout_amount, store_uuid, origin_store_uuid")
      .eq("membership_id", hostess_id)
      .is("deleted_at", null)

    // 본 매장에 origin 인 row 만 (= 본 매장이 정산 책임)
    const relevant = (parts ?? []).filter((p) =>
      p.store_uuid === auth.store_uuid || p.origin_store_uuid === auth.store_uuid,
    )
    const today_gross = relevant.reduce((a, p) => a + Number(p.price_amount ?? 0), 0)
    const today_hostess_payout = relevant.reduce((a, p) => a + Number(p.hostess_payout_amount ?? 0), 0)
    const today_count = relevant.length

    // 기존 state
    const { data: state } = await supabase
      .from("staff_payout_states")
      .select("status, base_amount, tip_amount, tip_held_amount, held_amount, paid_amount, paid_method, paid_at, memo, updated_at")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("hostess_membership_id", hostess_id)
      .is("deleted_at", null)
      .maybeSingle()

    return NextResponse.json({
      state: state ?? null,
      today_gross,
      today_hostess_payout,
      today_count,
      business_day_id: businessDayId,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: 401 })
    }
    console.error("[staff-payout] GET error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    if (auth.role === "manager") {
      const ok = await assertManagerCanView(supabase, auth.store_uuid, auth.membership_id, hostess_id)
      if (!ok) return NextResponse.json({ error: "NOT_ASSIGNED" }, { status: 403 })
    }

    const businessDayId = await getBizDayId(supabase, auth.store_uuid)
    if (!businessDayId) {
      return NextResponse.json({ error: "NO_BUSINESS_DAY" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: "pending" | "paid" | "held"
      tip_amount?: number
      tip_held_amount?: number
      held_amount?: number
      paid_amount?: number
      paid_method?: "cash" | "account"
      memo?: string
    }

    // base_amount = 현재 session_participants 합계 snapshot (참고)
    const { data: parts } = await supabase
      .from("session_participants")
      .select("hostess_payout_amount, store_uuid, origin_store_uuid")
      .eq("membership_id", hostess_id)
      .is("deleted_at", null)
    const relevant = (parts ?? []).filter((p) =>
      p.store_uuid === auth.store_uuid || p.origin_store_uuid === auth.store_uuid,
    )
    const baseAmount = relevant.reduce((a, p) => a + Number(p.hostess_payout_amount ?? 0), 0)

    // 기존 row
    const { data: existing } = await supabase
      .from("staff_payout_states")
      .select("id, status, tip_amount, tip_held_amount, held_amount, paid_amount, paid_method")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("hostess_membership_id", hostess_id)
      .is("deleted_at", null)
      .maybeSingle()

    const nowIso = new Date().toISOString()
    const payload: Record<string, unknown> = {
      updated_at: nowIso,
      updated_by: auth.user_id,
      base_amount: baseAmount,
    }
    if (body.status === "pending" || body.status === "paid" || body.status === "held") {
      payload.status = body.status
      if (body.status === "paid") {
        payload.paid_at = nowIso
        payload.paid_by = auth.user_id
      }
    }
    if (typeof body.tip_amount === "number") {
      payload.tip_amount = Math.max(0, Math.floor(body.tip_amount))
    }
    if (typeof body.tip_held_amount === "number") {
      payload.tip_held_amount = Math.max(0, Math.floor(body.tip_held_amount))
    }
    if (typeof body.held_amount === "number") {
      payload.held_amount = Math.max(0, Math.floor(body.held_amount))
    }
    if (typeof body.paid_amount === "number") {
      payload.paid_amount = Math.max(0, Math.floor(body.paid_amount))
    }
    if (body.paid_method === "cash" || body.paid_method === "account") {
      payload.paid_method = body.paid_method
    }
    if (typeof body.memo === "string") {
      payload.memo = body.memo.slice(0, 500)
    }

    if (existing?.id) {
      const { error } = await supabase
        .from("staff_payout_states")
        .update(payload)
        .eq("id", existing.id)
      if (error) {
        return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase
        .from("staff_payout_states")
        .insert({
          ...payload,
          store_uuid: auth.store_uuid,
          business_day_id: businessDayId,
          hostess_membership_id: hostess_id,
        })
      if (error) {
        return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: 401 })
    }
    console.error("[staff-payout] PATCH error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
