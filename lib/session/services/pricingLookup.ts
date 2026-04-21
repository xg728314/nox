import type { SupabaseClient } from "@supabase/supabase-js"

export type CategoryPricing = {
  price: number
  cha3Amount: number
  bantiAmount: number
}

/**
 * Resolves time_type from time_minutes and category.
 * Matches the existing logic in participants POST and PATCH flows.
 */
export function resolveTimeType(
  timeMinutes: number,
  category: string
): string {
  const halfTime = category === "퍼블릭" ? 45 : 30
  if (timeMinutes <= 15) return "차3"
  if (timeMinutes <= halfTime) return "반티"
  return "기본"
}

/**
 * Looks up the price for a given category + time_type from store_service_types.
 * Also fetches cha3 and banti prices for the same category.
 *
 * Extracts the triple-lookup pattern duplicated in:
 * - participants/route.ts POST (registration pricing)
 * - participants/[participant_id]/route.ts PATCH fillUnspecified
 * - participants/[participant_id]/route.ts PATCH updateCategory
 */
export async function lookupCategoryPricing(
  supabase: SupabaseClient,
  store_uuid: string,
  category: string,
  timeType: string
): Promise<CategoryPricing> {
  // Main price for the resolved time_type
  const { data: sst } = await supabase
    .from("store_service_types")
    .select("price")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", timeType)
    .eq("is_active", true)
    .maybeSingle()
  const price = sst?.price ?? 0

  // cha3 price
  const { data: cha3Type } = await supabase
    .from("store_service_types")
    .select("price")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", "차3")
    .eq("is_active", true)
    .maybeSingle()
  const cha3Amount = cha3Type?.price ?? 30000

  // banti price
  const { data: bantiType } = await supabase
    .from("store_service_types")
    .select("price")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", "반티")
    .eq("is_active", true)
    .maybeSingle()
  const bantiAmount = bantiType?.price ?? 0

  return { price, cha3Amount, bantiAmount }
}

/**
 * Full service type lookup including manager_deduction and greeting check.
 * Used only by participants POST registration flow.
 */
export async function lookupServiceType(
  supabase: SupabaseClient,
  store_uuid: string,
  category: string,
  timeType: string
): Promise<{ price: number; manager_deduction: number; has_greeting_check: boolean } | null> {
  const { data, error } = await supabase
    .from("store_service_types")
    .select("price, manager_deduction, has_greeting_check")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", timeType)
    .eq("is_active", true)
    .maybeSingle()

  if (error || !data) return null
  return data
}
