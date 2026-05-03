/**
 * computePayout — 종이장부 staff_entry 자동 환산.
 *
 * 운영자가 "1번방 ... 한나 1개반 / 가은 3개반 / 라원 2개반" 처럼 시간만 적고
 * 금액을 안 적었을 때, qty_full + has_half + origin_store + service_type 으로
 * 그 매장 store_service_types 단가표를 lookup 해 hostess_payout_won 자동 계산.
 *
 * 정책:
 *   - 매장별 단가는 origin_store_uuid 기준 (그 hostess 의 소속 매장 정산기준).
 *   - origin_store 명을 store_uuid 로 resolve (stores.store_name).
 *   - store_service_types(service_type, time_type='기본') = 정식가
 *     store_service_types(service_type, time_type='반티') = 반티가
 *     store_service_types(service_type, time_type='차3')  = 차3가
 *   - amount = qty_full × 정식가 + (has_half ? 반티가 : 0)
 *     time_tier='차3' 이면 차3가 1회, time_tier='반차3' 이면 반티가+차3가.
 *   - lookup 실패 (매장 없음, service_type 미설정) → 0 으로 두고 노출 X (skip).
 *     운영자 검수 단계에서 수동으로 채우면 됨.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PaperExtraction, RoomStaffEntry, ServiceType, TimeTier } from "./types"

type StorePricing = Map<string, number>
// key = `${service_type}:${time_type}` → price
const cache = new Map<string, { fetched_at: number; pricing: StorePricing }>()
const TTL_MS = 60_000

async function loadStorePricingByName(
  supabase: SupabaseClient,
  storeName: string,
): Promise<{ store_uuid: string; pricing: StorePricing } | null> {
  const trimmed = storeName.trim()
  if (!trimmed) return null

  // store_uuid resolve (caching by name).
  const { data: storeRow } = await supabase
    .from("stores")
    .select("id")
    .eq("store_name", trimmed)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()
  if (!storeRow?.id) return null

  const storeUuid = storeRow.id as string
  const cached = cache.get(storeUuid)
  if (cached && Date.now() - cached.fetched_at < TTL_MS) {
    return { store_uuid: storeUuid, pricing: cached.pricing }
  }

  const { data: rows } = await supabase
    .from("store_service_types")
    .select("service_type, time_type, price")
    .eq("store_uuid", storeUuid)
    .eq("is_active", true)
  const pricing: StorePricing = new Map()
  for (const r of (rows ?? []) as Array<{ service_type: string; time_type: string; price: number }>) {
    pricing.set(`${r.service_type}:${r.time_type}`, Number(r.price) || 0)
  }
  cache.set(storeUuid, { fetched_at: Date.now(), pricing })
  return { store_uuid: storeUuid, pricing }
}

function priceOf(pricing: StorePricing, service: ServiceType, timeType: string): number {
  return pricing.get(`${service}:${timeType}`) ?? 0
}

/**
 * 단일 entry 금액 계산. 단가표가 부족하면 0.
 */
function computeEntryAmount(
  entry: RoomStaffEntry,
  pricing: StorePricing,
): number | null {
  const service = entry.service_type as ServiceType | undefined
  if (!service) return null

  const tier = entry.time_tier as TimeTier | undefined
  const qtyFull = typeof entry.qty_full === "number" ? entry.qty_full : 0
  const hasHalf = entry.has_half === true

  // time_tier 우선 처리 (qty_full / has_half 가 없는 단순 케이스).
  if (tier === "차3") {
    return priceOf(pricing, service, "차3") || null
  }
  if (tier === "반차3") {
    const p = priceOf(pricing, service, "반티") + priceOf(pricing, service, "차3")
    return p || null
  }
  if (tier === "free") return 0

  // 복합 표기: qty_full × 기본 + (has_half ? 반티 : 0)
  // 또는 단순 표기: time_tier 만 보고 fallback.
  if (qtyFull === 0 && !hasHalf) {
    if (tier === "완티") return priceOf(pricing, service, "기본") || null
    if (tier === "반티") return priceOf(pricing, service, "반티") || null
    return null
  }
  const basePrice = priceOf(pricing, service, "기본")
  const halfPrice = priceOf(pricing, service, "반티")
  if (qtyFull > 0 && basePrice <= 0) return null
  if (hasHalf && halfPrice <= 0) return null
  const total = qtyFull * basePrice + (hasHalf ? halfPrice : 0)
  return total > 0 ? total : null
}

/**
 * extraction.rooms[*].staff_entries 의 hostess_payout_won 자동 채움.
 * 이미 hostess_payout_won 이 0 이상으로 박혀 있으면 보존 (운영자 직접 입력).
 * lookup 실패한 매장은 변경하지 않음.
 */
export async function fillExtractionPayouts(
  supabase: SupabaseClient,
  extraction: PaperExtraction,
): Promise<void> {
  if (!extraction.rooms || extraction.rooms.length === 0) return

  // 매장별로 묶어서 1매장 1번 lookup.
  const storeNames = new Set<string>()
  for (const room of extraction.rooms) {
    for (const e of room.staff_entries ?? []) {
      if (e.origin_store && (e.hostess_payout_won ?? 0) === 0) {
        storeNames.add(e.origin_store.trim())
      }
    }
  }
  if (storeNames.size === 0) return

  const pricingByStore = new Map<string, StorePricing>()
  await Promise.all(
    Array.from(storeNames).map(async (name) => {
      const r = await loadStorePricingByName(supabase, name)
      if (r) pricingByStore.set(name, r.pricing)
    }),
  )

  for (const room of extraction.rooms) {
    for (const e of room.staff_entries ?? []) {
      if ((e.hostess_payout_won ?? 0) > 0) continue
      const name = e.origin_store?.trim()
      if (!name) continue
      const pricing = pricingByStore.get(name)
      if (!pricing) continue
      const amount = computeEntryAmount(e, pricing)
      if (amount !== null && amount > 0) {
        e.hostess_payout_won = amount
      }
    }
  }
}
