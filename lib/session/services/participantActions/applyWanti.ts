import type { SupabaseClient } from "@supabase/supabase-js"
import { PricingLookupError } from "@/lib/session/services/pricingLookup"

/**
 * Action: wanti — look up 기본 price from store_service_types and set.
 *
 * R-strict-lookup (2026-08-24): 이전엔 sst null 시 silent fallback (기존 price 유지).
 *   사용자 UI 는 "완티 적용됨" 표시 · 실제 금액 변화 없음 → 정산 불일치.
 *   또한 sst.price 가 NUMERIC string 이면 `- number` 에서 NaN 발생 → hostess_payout NaN.
 *   Fix: sst 없으면 PricingLookupError throw. toNum 가드 적용.
 */
function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

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

  if (!sst || sst.price == null) {
    throw new PricingLookupError("base", participant.category, "기본")
  }
  const newPrice = toNum(sst.price)
  const newHostess = Math.max(0, newPrice - toNum(participant.manager_payout_amount))
  return {
    updatePayload: {
      price_amount: newPrice,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "wanti_applied",
  }
}
