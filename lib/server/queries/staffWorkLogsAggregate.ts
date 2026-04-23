/**
 * Pure helpers for the Phase 4 staff_work_logs → cross_store settlement
 * aggregate route. Extracted for unit-testability — behaviour identical to
 * the in-route implementation. No I/O. No Supabase calls.
 *
 * Policy (locked):
 *   - amount 의 기준은 항상 store_service_types DB 단가 (priceMap).
 *   - external_amount_hint 는 "선호값" 아닌 **검증값**.
 *     hint > 0 이고 DB sum 과 다르면 skip.
 *   - 매핑 불가(category / work_type) / 0원 / 음수 → skip.
 */

export const CATEGORY_MAP: Record<string, string> = {
  public: "퍼블릭",
  shirt: "셔츠",
  hyper: "하퍼",
}

export const WORK_TYPE_TIME_TYPES: Record<string, string[]> = {
  full: ["기본"],
  half: ["반티"],
  cha3: ["차3"],
  half_cha3: ["반티", "차3"],
}

export type ResolveAmountInput = {
  category: string
  work_type: string
  external_amount_hint: number | null
}

export type AmountResolution =
  | { ok: true; amount: number }
  | { ok: false; reason: string }

/**
 * priceMap key 포맷: `${service_type}__${time_type}` (e.g. "셔츠__차3").
 * 값은 price (원). 빈 맵 또는 미등록 키 → skip.
 */
export function resolveAmount(
  log: ResolveAmountInput,
  priceMap: Map<string, number>,
): AmountResolution {
  const serviceType = CATEGORY_MAP[log.category]
  const timeTypes = WORK_TYPE_TIME_TYPES[log.work_type]

  if (!serviceType) {
    return { ok: false, reason: `category=${log.category} 단가 매칭 불가` }
  }
  if (!timeTypes) {
    return { ok: false, reason: `work_type=${log.work_type} 단가 매칭 불가` }
  }

  let sum = 0
  for (const tt of timeTypes) {
    const p = priceMap.get(`${serviceType}__${tt}`)
    if (p == null || p <= 0) {
      return { ok: false, reason: `store_service_types(${serviceType}, ${tt}) 미등록/0원` }
    }
    sum += p
  }

  if (!(sum > 0)) {
    return { ok: false, reason: "합산 단가 0 이하" }
  }

  const hint = Number(log.external_amount_hint)
  if (Number.isFinite(hint) && hint > 0 && hint !== sum) {
    return {
      ok: false,
      reason: `external_amount_hint(${hint}) 와 DB 단가(${sum}) 불일치`,
    }
  }

  return { ok: true, amount: sum }
}
