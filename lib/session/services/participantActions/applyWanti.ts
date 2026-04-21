import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Action: wanti — look up 기본 price from store_service_types and set.
 */
export async function applyWanti(
  supabase: SupabaseClient,
  store_uuid: string,
  participant: { category: string; price_amount: number; manager_payout_amount: number }
): Promise<{
  updatePayload: Record<string, number | string | boolean>
  actionLabel: string
}> {
  const { data: sst } = await supabase
    .from("store_service_types")
    .select("price, manager_deduction")
    .eq("store_uuid", store_uuid)
    .eq("service_type", participant.category)
    .eq("time_type", "기본")
    .eq("is_active", true)
    .maybeSingle()

  const newPrice = sst?.price ?? participant.price_amount
  const newHostess = Math.max(0, newPrice - participant.manager_payout_amount)
  return {
    updatePayload: {
      price_amount: newPrice,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "wanti_applied",
  }
}
