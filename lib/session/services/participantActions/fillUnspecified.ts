import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { lookupCategoryPricing, resolveTimeType } from "@/lib/session/services/pricingLookup"

type FillInput = {
  membership_id: string | null
  external_name?: string
  category?: string
  time_minutes?: number
  entered_at?: string
  manager_membership_id?: string
  origin_store_uuid?: string
}

type ParticipantState = {
  category: string
  time_minutes: number
  manager_payout_amount: number
}

/**
 * Action: fill unspecified participant — set membership_id + category + time + pricing.
 *
 * Includes manager_membership_id validation (role=manager, store scope).
 */
export async function fillUnspecified(
  supabase: SupabaseClient,
  store_uuid: string,
  body: FillInput,
  participant: ParticipantState
): Promise<
  | { updatePayload: Record<string, number | string | boolean>; actionLabel: string; error?: never }
  | { error: NextResponse; updatePayload?: never; actionLabel?: never }
> {
  const VALID_CATS = ["퍼블릭", "셔츠", "하퍼"]
  const newCategory = body.category ?? participant.category
  const newTime = body.time_minutes ?? participant.time_minutes ?? 0
  if (newCategory && !VALID_CATS.includes(newCategory)) {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "category must be one of: 퍼블릭, 셔츠, 하퍼." },
        { status: 400 }
      ),
    }
  }

  // Pricing lookup
  let newPrice = 0
  let newCha3 = 30000
  let newBanti = 0
  if (newTime > 0 && newCategory) {
    const timeType = resolveTimeType(newTime, newCategory)
    const pricing = await lookupCategoryPricing(supabase, store_uuid, newCategory, timeType)
    newPrice = pricing.price
    newCha3 = pricing.cha3Amount
    newBanti = pricing.bantiAmount
  }

  // manager_membership_id validation
  if (body.manager_membership_id) {
    const { data: mgrMembership } = await supabase
      .from("store_memberships")
      .select("id, role, store_uuid")
      .eq("id", body.manager_membership_id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!mgrMembership) {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "manager_membership_id가 존재하지 않습니다." },
          { status: 400 }
        ),
      }
    }
    if (mgrMembership.role !== "manager") {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "해당 membership은 실장(manager) 역할이 아닙니다." },
          { status: 400 }
        ),
      }
    }
    const allowedStore = body.origin_store_uuid ?? store_uuid
    if (mgrMembership.store_uuid !== allowedStore && mgrMembership.store_uuid !== store_uuid) {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "해당 매장 소속 실장이 아닙니다." },
          { status: 400 }
        ),
      }
    }
  }

  const newHostess = Math.max(0, newPrice - participant.manager_payout_amount)
  const updatePayload: Record<string, number | string | boolean> = {
    membership_id: body.membership_id as unknown as string,
    ...(body.external_name !== undefined ? { external_name: body.external_name } : {}),
    category: newCategory,
    time_minutes: newTime,
    price_amount: newPrice,
    cha3_amount: newCha3,
    banti_amount: newBanti,
    hostess_payout_amount: newHostess,
    memo: "",
    ...(body.entered_at ? { entered_at: body.entered_at } : {}),
    ...(body.manager_membership_id ? { manager_membership_id: body.manager_membership_id } : {}),
    ...(body.origin_store_uuid ? { origin_store_uuid: body.origin_store_uuid } : {}),
  }

  return { updatePayload, actionLabel: "unspec_filled" }
}
