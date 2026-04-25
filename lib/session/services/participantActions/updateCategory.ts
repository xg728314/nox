import type { SupabaseClient } from "@supabase/supabase-js"
import { lookupCategoryPricing, lookupServiceType, resolveTimeType } from "@/lib/session/services/pricingLookup"

/**
 * Action: category change — re-price from store_service_types for the new category.
 *
 * 2026-04-24 P1 fix: participant.manager_payout_amount === 0 (placeholder /
 *   기본값) 일 때 신규 category 의 기본 manager_deduction 을 DB 에서 재조회
 *   해서 적용. 이전에는 항상 0 유지 → 실장 수익 0 고정 버그.
 */
export async function updateCategory(
  supabase: SupabaseClient,
  store_uuid: string,
  newCategory: string,
  participant: { time_minutes: number; manager_payout_amount: number }
): Promise<{
  updatePayload: Record<string, number | string | boolean>
  actionLabel: string
}> {
  const tm = participant.time_minutes ?? 0
  const timeType = resolveTimeType(tm, newCategory)

  const pricing = await lookupCategoryPricing(supabase, store_uuid, newCategory, timeType)

  let effectiveManagerDeduction = participant.manager_payout_amount ?? 0
  if (effectiveManagerDeduction === 0) {
    const svc = await lookupServiceType(supabase, store_uuid, newCategory, timeType)
    if (svc && typeof svc.manager_deduction === "number") {
      effectiveManagerDeduction = svc.manager_deduction
    }
  }

  const newHostess = Math.max(0, pricing.price - effectiveManagerDeduction)
  return {
    updatePayload: {
      category: newCategory,
      price_amount: pricing.price,
      cha3_amount: pricing.cha3Amount,
      banti_amount: pricing.bantiAmount,
      manager_payout_amount: effectiveManagerDeduction,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "category_updated",
  }
}
