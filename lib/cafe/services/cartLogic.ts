/**
 * 카페 장바구니 서버 로직.
 *
 * 입력: { menu_id, qty, option_ids[] } 리스트.
 * 출력: items jsonb snapshot (price + options price_delta) + subtotal.
 *
 * 검증:
 *   - 메뉴 활성 + 같은 카페 store_uuid
 *   - 옵션 → 그 옵션의 group → 그 group 의 menu 가 입력 menu 와 일치
 *   - is_required 그룹은 옵션 ≥ min_select, ≤ max_select
 *   - 클라이언트가 보낸 가격은 신뢰 X (DB 단가 SSOT)
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CafeOrderItem } from "../types"

export type ResolvedCart = {
  items: CafeOrderItem[]
  subtotal: number
}

export async function resolveCart(
  supabase: SupabaseClient,
  cafe_store_uuid: string,
  inputs: Array<{ menu_id: string; qty: number; option_ids?: string[] }>,
): Promise<{ ok: true; data: ResolvedCart } | { ok: false; error: string }> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, error: "items must be a non-empty array" }
  }
  for (const it of inputs) {
    if (typeof it.menu_id !== "string" || !it.menu_id) {
      return { ok: false, error: "items[].menu_id required" }
    }
    if (!Number.isFinite(it.qty) || it.qty < 1 || it.qty > 99) {
      return { ok: false, error: "items[].qty must be 1~99" }
    }
  }

  // 1) 메뉴 검증
  const menuIds = Array.from(new Set(inputs.map((i) => i.menu_id)))
  const { data: menus, error: menuErr } = await supabase
    .from("cafe_menu_items")
    .select("id, store_uuid, name, price, is_active, deleted_at")
    .in("id", menuIds)
    .eq("store_uuid", cafe_store_uuid)
  if (menuErr) return { ok: false, error: menuErr.message }
  type MenuRow = { id: string; name: string; price: number; is_active: boolean; deleted_at: string | null }
  const menuMap = new Map<string, MenuRow>()
  for (const m of (menus ?? []) as MenuRow[]) menuMap.set(m.id, m)
  for (const id of menuIds) {
    const m = menuMap.get(id)
    if (!m || !m.is_active || m.deleted_at) {
      return { ok: false, error: `메뉴 ${id} 비활성/삭제` }
    }
  }

  // 2) 옵션 검증 — 모든 입력의 option_ids 한 번에 fetch
  const allOptionIds = Array.from(new Set(
    inputs.flatMap((i) => i.option_ids ?? []).filter(Boolean),
  ))
  type OptRow = {
    id: string; group_id: string; name: string; price_delta: number; is_active: boolean; deleted_at: string | null
    group: { id: string; menu_id: string; name: string; is_required: boolean; min_select: number; max_select: number; deleted_at: string | null } | null
  }
  let optionMap = new Map<string, OptRow>()
  if (allOptionIds.length > 0) {
    const { data: opts, error: optErr } = await supabase
      .from("cafe_menu_options")
      .select(`
        id, group_id, name, price_delta, is_active, deleted_at,
        group:cafe_menu_option_groups (id, menu_id, name, is_required, min_select, max_select, deleted_at)
      `)
      .in("id", allOptionIds)
    if (optErr) return { ok: false, error: optErr.message }
    for (const o of (opts ?? []) as unknown as OptRow[]) {
      if (o.is_active && !o.deleted_at && o.group && !o.group.deleted_at) {
        optionMap.set(o.id, o)
      }
    }
  }

  // 3) 메뉴별 required group 검증 — input 에 들어온 옵션의 group 들 모음
  // 각 group 에 대해 min_select/max_select 통과여부.
  // required 인데 옵션 미선택은 별도 query 로 group 조회 해야 함.
  // 간단화: 입력에 없는 menu 의 required group 도 fetch 해서 확인.
  type GroupReq = { id: string; menu_id: string; is_required: boolean; min_select: number; max_select: number }
  const requiredGroupsByMenu = new Map<string, GroupReq[]>()
  {
    const { data: groups, error: gErr } = await supabase
      .from("cafe_menu_option_groups")
      .select("id, menu_id, is_required, min_select, max_select, is_active, deleted_at")
      .in("menu_id", menuIds)
    if (gErr) return { ok: false, error: gErr.message }
    for (const g of (groups ?? []) as Array<GroupReq & { is_active: boolean; deleted_at: string | null }>) {
      if (!g.is_active || g.deleted_at) continue
      const arr = requiredGroupsByMenu.get(g.menu_id) ?? []
      arr.push(g)
      requiredGroupsByMenu.set(g.menu_id, arr)
    }
  }

  const items: CafeOrderItem[] = []
  let subtotal = 0
  for (const inp of inputs) {
    const m = menuMap.get(inp.menu_id)!
    const optionIds = inp.option_ids ?? []
    const selectedOpts: NonNullable<CafeOrderItem["options"]> = []

    // group 별 선택 카운트
    const countByGroup = new Map<string, number>()
    for (const oid of optionIds) {
      const o = optionMap.get(oid)
      if (!o || !o.group) return { ok: false, error: `옵션 ${oid} 비활성/삭제` }
      if (o.group.menu_id !== inp.menu_id) {
        return { ok: false, error: `옵션 ${oid} 가 메뉴 ${m.name} 에 속하지 않음` }
      }
      countByGroup.set(o.group_id, (countByGroup.get(o.group_id) ?? 0) + 1)
      selectedOpts.push({ option_id: oid, name: o.name, price_delta: o.price_delta })
    }
    // group min/max + required 검증
    const menuGroups = requiredGroupsByMenu.get(inp.menu_id) ?? []
    for (const g of menuGroups) {
      const c = countByGroup.get(g.id) ?? 0
      if (g.is_required && c < g.min_select) {
        return { ok: false, error: `메뉴 ${m.name} 의 필수 옵션 그룹 미선택` }
      }
      if (c > g.max_select) {
        return { ok: false, error: `메뉴 ${m.name} 옵션 그룹 최대 ${g.max_select} 초과` }
      }
    }

    const optSum = selectedOpts.reduce((s, o) => s + o.price_delta, 0)
    const unitPrice = m.price + optSum
    items.push({
      menu_id: inp.menu_id, name: m.name, price: m.price, qty: inp.qty,
      options: selectedOpts.length > 0 ? selectedOpts : undefined,
      unit_price: unitPrice,
    })
    subtotal += unitPrice * inp.qty
  }

  return { ok: true, data: { items, subtotal } }
}
