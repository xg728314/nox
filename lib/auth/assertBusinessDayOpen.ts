import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Guard: reject mutations when the session's business day is closed.
 *
 * Pass the session's `business_day_id` (from room_sessions.business_day_id).
 * If the referenced store_operating_days row has `status='closed'`, returns
 * a NextResponse with 403 BUSINESS_DAY_CLOSED. Otherwise returns null.
 *
 * Usage:
 *   const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
 *   if (guard) return guard
 *
 * NOTE: read endpoints must NOT call this — it's mutation-only by design.
 */
export async function assertBusinessDayOpen(
  supabase: SupabaseClient,
  business_day_id: string | null | undefined
): Promise<NextResponse | null> {
  if (!business_day_id) return null
  const { data } = await supabase
    .from("store_operating_days")
    .select("status")
    .eq("id", business_day_id)
    .is("deleted_at", null)
    .maybeSingle()
  if (data && data.status === "closed") {
    return NextResponse.json(
      {
        error: "BUSINESS_DAY_CLOSED",
        message: "영업일이 마감되었습니다. 수정할 수 없습니다.",
      },
      { status: 403 }
    )
  }
  return null
}

/**
 * STEP-017: resolve business_day_id from a settlement_item → settlements →
 * room_sessions chain and assert the day is still open.
 *
 * Used by payout / payout-cancel routes where the caller only has the
 * settlement_item_id or payout_id. Returns null when no closed-day conflict.
 */
export async function assertBusinessDayOpenBySettlementItem(
  supabase: SupabaseClient,
  store_uuid: string,
  settlement_item_id: string
): Promise<NextResponse | null> {
  const { data: itemRow } = await supabase
    .from("settlement_items")
    .select("settlement_id")
    .eq("id", settlement_item_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  if (!itemRow?.settlement_id) return null
  const { data: setRow } = await supabase
    .from("settlements")
    .select("session_id")
    .eq("id", itemRow.settlement_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  if (!setRow?.session_id) return null
  const { data: sesRow } = await supabase
    .from("room_sessions")
    .select("business_day_id")
    .eq("id", setRow.session_id)
    .eq("store_uuid", store_uuid)
    .maybeSingle()
  return assertBusinessDayOpen(supabase, sesRow?.business_day_id)
}

/**
 * STEP-021: cross-store closing policy.
 *
 * Cross-store routes do not reference a single session, so there is no
 * session→business_day link to guard on. Policy: reject cross-store writes
 * whenever the store's most recent business day is `closed`. Once an
 * operator starts a new day (or reopens), writes unlock automatically.
 */
export async function assertStoreHasOpenDay(
  supabase: SupabaseClient,
  store_uuid: string
): Promise<NextResponse | null> {
  const { data } = await supabase
    .from("store_operating_days")
    .select("status")
    .eq("store_uuid", store_uuid)
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data && data.status === "closed") {
    return NextResponse.json(
      {
        error: "BUSINESS_DAY_CLOSED",
        message: "영업일이 마감되었습니다. 새 영업일을 시작한 후 다시 시도하세요.",
      },
      { status: 403 }
    )
  }
  return null
}

/**
 * STEP-017: resolve business_day_id from a payout_records row.
 */
export async function assertBusinessDayOpenByPayout(
  supabase: SupabaseClient,
  store_uuid: string,
  payout_id: string
): Promise<NextResponse | null> {
  const { data: pay } = await supabase
    .from("payout_records")
    .select("settlement_item_id")
    .eq("id", payout_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  if (!pay?.settlement_item_id) return null
  return assertBusinessDayOpenBySettlementItem(supabase, store_uuid, pay.settlement_item_id)
}
