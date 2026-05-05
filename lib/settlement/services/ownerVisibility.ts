import type { SupabaseClient } from "@supabase/supabase-js"
import { cached } from "@/lib/cache/inMemoryTtl"

type OwnerVisibilityFlags = {
  showManager: boolean
  showHostess: boolean
}

// 2026-05-03 R-Speed-x10 part2: 매니저 visibility 토글은 거의 안 바뀜.
//   receipt/settlement/finalize 마다 호출되던 RTT 1회 절감 → cache hit ~1ms.
const VISIBILITY_TTL_MS = 30_000

/**
 * Queries manager visibility toggles for a store.
 *
 * Returns which settlement amounts an owner is allowed to see.
 * If ANY manager in the store has enabled a toggle, it's treated as visible.
 *
 * Extracts the repeated pattern from settlement/route.ts, finalize/route.ts,
 * and receipt/route.ts.
 */
export async function resolveOwnerVisibility(
  supabase: SupabaseClient,
  store_uuid: string
): Promise<OwnerVisibilityFlags> {
  return cached<OwnerVisibilityFlags>(
    "owner_visibility",
    store_uuid,
    VISIBILITY_TTL_MS,
    async () => {
      const { data: mgrRows } = await supabase
        .from("managers")
        .select("show_profit_to_owner, show_hostess_profit_to_owner")
        .eq("store_uuid", store_uuid)

      let showManager = false
      let showHostess = false
      for (const m of (mgrRows ?? []) as { show_profit_to_owner: boolean; show_hostess_profit_to_owner: boolean }[]) {
        if (m.show_profit_to_owner) showManager = true
        if (m.show_hostess_profit_to_owner) showHostess = true
      }

      return { showManager, showHostess }
    },
  )
}

/**
 * Applies owner visibility rules to a settlement response object.
 *
 * For owner role: only includes manager/hostess amounts if the toggles allow it.
 * For other roles: includes all amounts unconditionally.
 */
export function applyOwnerVisibility(
  responseData: Record<string, unknown>,
  role: string,
  flags: OwnerVisibilityFlags,
  amounts: {
    managerAmount: number
    hostessAmount: number
    managerProfitTotal: number
    hostessProfitTotal: number
  }
): void {
  if (role === "owner") {
    if (flags.showManager) {
      responseData.manager_amount = amounts.managerAmount
      responseData.manager_profit_total = amounts.managerProfitTotal
    }
    if (flags.showHostess) {
      responseData.hostess_amount = amounts.hostessAmount
      responseData.hostess_profit_total = amounts.hostessProfitTotal
    }
  } else {
    responseData.manager_amount = amounts.managerAmount
    responseData.hostess_amount = amounts.hostessAmount
    responseData.manager_profit_total = amounts.managerProfitTotal
    responseData.hostess_profit_total = amounts.hostessProfitTotal
  }
}
