import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type InventoryItem = {
  id: string
  name: string
  unit: string
  current_stock: number
  min_stock: number
  unit_cost: number
  store_price?: number | null
  cost_per_box?: number | null
  cost_per_unit?: number | null
  units_per_box: number
  is_active: boolean
  updated_at: string
  converted_stock: number
  is_low_stock: boolean
  is_out_of_stock: boolean
}

export type InventoryItemsResponse = {
  items: InventoryItem[]
  summary: {
    total: number
    low_stock: number
    out_of_stock: number
  }
}

export async function getInventoryItems(
  auth: AuthContext,
  params: { include_inactive?: boolean } = {},
): Promise<InventoryItemsResponse> {
  const supabase = getServiceClient()

  const showInactive = !!params.include_inactive

  let query = supabase
    .from("inventory_items")
    .select("id, name, unit, current_stock, min_stock, unit_cost, store_price, units_per_box, cost_per_box, cost_per_unit, is_active, updated_at")
    .eq("store_uuid", auth.store_uuid)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (!showInactive) {
    query = query.eq("is_active", true)
  }

  const { data: items, error: queryError } = await query

  if (queryError) throw new Error("QUERY_FAILED")

  const enriched: InventoryItem[] = (items ?? []).map((item: {
    id: string; name: string; unit: string;
    current_stock: number; min_stock: number; unit_cost: number;
    store_price?: number | null; cost_per_box?: number | null; cost_per_unit?: number | null;
    units_per_box?: number | null;
    is_active: boolean; updated_at: string
  }) => {
    const upb = item.units_per_box && item.units_per_box > 0 ? item.units_per_box : 1
    const isBoxed = (item.unit === "박스") && upb > 1
    return {
      ...item,
      units_per_box: upb,
      converted_stock: isBoxed ? item.current_stock * upb : item.current_stock,
      is_low_stock: item.min_stock > 0 && item.current_stock <= item.min_stock,
      is_out_of_stock: item.current_stock <= 0,
    }
  })

  const lowStockCount = enriched.filter((i) => i.is_low_stock).length
  const outOfStockCount = enriched.filter((i) => i.is_out_of_stock).length

  return {
    items: enriched,
    summary: {
      total: enriched.length,
      low_stock: lowStockCount,
      out_of_stock: outOfStockCount,
    },
  }
}
