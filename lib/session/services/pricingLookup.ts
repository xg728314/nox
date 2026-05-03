import type { SupabaseClient } from "@supabase/supabase-js"

export type CategoryPricing = {
  price: number
  cha3Amount: number
  bantiAmount: number
}

// 2026-05-01 R-Counter-Speed: store_service_types 는 영업일 잠금 정책상
//   매 hot-path (참여자 추가/수정) 마다 3-4 회 조회됐다. 매장 × 종목 단위
//   process-local TTL 캐시. invalidate 는 store/service-types/route.ts
//   의 PUT/PATCH/DELETE 에서 호출되도록 export.
type StoreServiceTypesCache = {
  fetched_at: number
  rows: Array<{
    service_type: string
    time_type: string
    price: number
    manager_deduction: number
    has_greeting_check: boolean
  }>
}
const sstCache = new Map<string, StoreServiceTypesCache>()
const SST_TTL_MS = 60_000 // 1분 — 단가 변경 후 1분 내 반영. 잠금 정책상 영업일 중 거의 변경 없음.

export function invalidateStoreServiceTypesCache(store_uuid: string) {
  sstCache.delete(store_uuid)
}

async function loadStoreServiceTypes(
  supabase: SupabaseClient,
  store_uuid: string,
): Promise<StoreServiceTypesCache["rows"]> {
  const hit = sstCache.get(store_uuid)
  if (hit && Date.now() - hit.fetched_at < SST_TTL_MS) return hit.rows
  const { data, error } = await supabase
    .from("store_service_types")
    .select("service_type, time_type, price, manager_deduction, has_greeting_check")
    .eq("store_uuid", store_uuid)
    .eq("is_active", true)
  if (error) throw error
  const rows = (data ?? []) as StoreServiceTypesCache["rows"]
  sstCache.set(store_uuid, { fetched_at: Date.now(), rows })
  return rows
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
  const rows = await loadStoreServiceTypes(supabase, store_uuid)
  const find = (tt: string) =>
    rows.find((r) => r.service_type === category && r.time_type === tt)
  const sst = find(timeType)
  if (!sst || typeof sst.price !== "number") {
    throw new PricingLookupError("base", category, timeType)
  }
  const cha3Type = find("차3")
  if (!cha3Type || typeof cha3Type.price !== "number") {
    throw new PricingLookupError("cha3", category)
  }
  const bantiType = find("반티")
  if (!bantiType || typeof bantiType.price !== "number") {
    throw new PricingLookupError("banti", category)
  }
  return { price: sst.price, cha3Amount: cha3Type.price, bantiAmount: bantiType.price }
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
  const rows = await loadStoreServiceTypes(supabase, store_uuid)
  const r = rows.find((row) => row.service_type === category && row.time_type === timeType)
  if (!r) return null
  return { price: r.price, manager_deduction: r.manager_deduction, has_greeting_check: r.has_greeting_check }
}
