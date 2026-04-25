import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { lookupCategoryPricing, lookupServiceType, resolveTimeType } from "@/lib/session/services/pricingLookup"

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
  //   2026-04-24 P1 fix: placeholder 참여자가 처음으로 category 확정될 때
  //     해당 category 의 기본 manager_deduction 이 DB 에서 재조회되지 않고
  //     participant.manager_payout_amount (= 0) 가 그대로 유지되던 버그.
  //     참여자가 아직 수동으로 공제액을 설정한 적이 없으면 (=0) 신규
  //     category 의 기본값을 적용.
  let newPrice = 0
  let newCha3 = 0
  let newBanti = 0
  let effectiveManagerDeduction = participant.manager_payout_amount ?? 0
  if (newTime > 0 && newCategory) {
    const timeType = resolveTimeType(newTime, newCategory)
    const pricing = await lookupCategoryPricing(supabase, store_uuid, newCategory, timeType)
    newPrice = pricing.price
    newCha3 = pricing.cha3Amount
    newBanti = pricing.bantiAmount

    if (effectiveManagerDeduction === 0) {
      const svc = await lookupServiceType(supabase, store_uuid, newCategory, timeType)
      if (svc && typeof svc.manager_deduction === "number") {
        effectiveManagerDeduction = svc.manager_deduction
      }
    }
  }

  // manager_membership_id validation
  //   2026-04-25: 검증 완화 (사용자 운영 요청).
  //     이전 룰: origin_store OR 현재 store 의 manager 만 허용 → bulk picker
  //       에서 origin_store_uuid 가 누락되거나 cross-store 시나리오에서
  //       "해당 매장 소속 실장이 아닙니다" 로 스태프 확정 자체가 불가.
  //       실전에서 영업 중단 유발.
  //     새 룰: 존재 + role=manager + status=approved + not-deleted 만 검증.
  //       매장 스코프는 풀어서 스태프 저장 자체가 막히지 않게 함. 실장이
  //       실제로 엉뚱하면 나중에 수정 가능 (editor 로 교체).
  if (body.manager_membership_id) {
    const { data: mgrMembership } = await supabase
      .from("store_memberships")
      .select("id, role, status, store_uuid")
      .eq("id", body.manager_membership_id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!mgrMembership) {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "선택한 실장을 찾을 수 없습니다." },
          { status: 400 }
        ),
      }
    }
    if (mgrMembership.role !== "manager") {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "선택한 계정은 실장(manager) 역할이 아닙니다." },
          { status: 400 }
        ),
      }
    }
    if (mgrMembership.status !== "approved") {
      return {
        error: NextResponse.json(
          { error: "BAD_REQUEST", message: "승인되지 않은 실장 계정입니다." },
          { status: 400 }
        ),
      }
    }
    // 매장 스코프 검증 제거 — cross-store 운영 허용.
  }

  const newHostess = Math.max(0, newPrice - effectiveManagerDeduction)
  const updatePayload: Record<string, number | string | boolean> = {
    membership_id: body.membership_id as unknown as string,
    ...(body.external_name !== undefined ? { external_name: body.external_name } : {}),
    category: newCategory,
    time_minutes: newTime,
    price_amount: newPrice,
    cha3_amount: newCha3,
    banti_amount: newBanti,
    manager_payout_amount: effectiveManagerDeduction,
    hostess_payout_amount: newHostess,
    memo: "",
    ...(body.entered_at ? { entered_at: body.entered_at } : {}),
    ...(body.manager_membership_id ? { manager_membership_id: body.manager_membership_id } : {}),
    ...(body.origin_store_uuid ? { origin_store_uuid: body.origin_store_uuid } : {}),
  }

  return { updatePayload, actionLabel: "unspec_filled" }
}
