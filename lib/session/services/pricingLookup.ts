import type { SupabaseClient } from "@supabase/supabase-js"

export type CategoryPricing = {
  price: number
  cha3Amount: number
  bantiAmount: number
}

/**
 * 단가 DB 조회 실패 시 던지는 전용 에러. 2026-04-24 P0 fix.
 *   - 이전에는 cha3=30000 / banti=0 하드코딩 fallback 이 있어서
 *     store_service_types 로딩이 일시 실패해도 계산이 조용히 진행됨.
 *   - 장부 시스템에서는 조용한 잘못된 금액 > 명시적 실패. 따라서
 *     단가 누락 시 예외를 던져 호출부가 5xx 를 반환하도록 한다.
 */
export class PricingLookupError extends Error {
  readonly code = "PRICING_LOOKUP_FAILED"
  constructor(
    public readonly missing: "base" | "cha3" | "banti",
    public readonly category: string,
    public readonly timeType?: string,
  ) {
    const timePart = timeType ? ` (time_type=${timeType})` : ""
    super(
      `store_service_types 에서 ${missing} 단가를 찾지 못했습니다. ` +
      `category=${category}${timePart}. ` +
      `store_settings/service-types 설정을 확인하세요.`,
    )
    this.name = "PricingLookupError"
  }
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
  if (!sst || typeof sst.price !== "number") {
    throw new PricingLookupError("base", category, timeType)
  }
  const price = sst.price

  // cha3 price — 2026-04-24: fallback 30000 제거 (장부 정확성).
  const { data: cha3Type } = await supabase
    .from("store_service_types")
    .select("price")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", "차3")
    .eq("is_active", true)
    .maybeSingle()
  if (!cha3Type || typeof cha3Type.price !== "number") {
    throw new PricingLookupError("cha3", category)
  }
  const cha3Amount = cha3Type.price

  // banti price — 2026-04-24: fallback 0 제거.
  const { data: bantiType } = await supabase
    .from("store_service_types")
    .select("price")
    .eq("store_uuid", store_uuid)
    .eq("service_type", category)
    .eq("time_type", "반티")
    .eq("is_active", true)
    .maybeSingle()
  if (!bantiType || typeof bantiType.price !== "number") {
    throw new PricingLookupError("banti", category)
  }
  const bantiAmount = bantiType.price

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
