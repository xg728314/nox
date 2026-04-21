import type { SupabaseClient } from "@supabase/supabase-js"
import { lookupCategoryPricing, resolveTimeType } from "@/lib/session/services/pricingLookup"

/**
 * Action: category change — re-price from store_service_types for the new category.
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

  const newHostess = Math.max(0, pricing.price - participant.manager_payout_amount)
  return {
    updatePayload: {
      category: newCategory,
      price_amount: pricing.price,
      cha3_amount: pricing.cha3Amount,
      banti_amount: pricing.bantiAmount,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "category_updated",
  }
}
