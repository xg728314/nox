/**
 * Sidebar menu presets — ready-made SidebarMenuConfig shapes the user
 * can apply. Role filtering always runs AFTER preset application
 * (resolveMenu re-filters at render time), so a preset cannot surface
 * a role-disallowed menu id.
 *
 * Normalization (unknown ids, togglable-only hidden) runs at editor
 * save time; presets are authored to satisfy it directly.
 */

import {
  DEFAULT_SIDEBAR_MENU,
  type MenuItemId,
  type SidebarMenuConfig,
} from "./menu"

export type SidebarMenuPreset = {
  id: string
  label: string
  description?: string
  config: SidebarMenuConfig
}

const DEFAULT_PRESET: SidebarMenuPreset = {
  id: "default",
  label: "기본",
  description: "manifest 기본 순서. 권한 허용 항목 모두 표시.",
  config: DEFAULT_SIDEBAR_MENU,
}

// "최소" — 카운터 + 내 정보 외는 숨김 (togglable 한 항목만 영향).
// counter 는 togglable=false 라 자동으로 항상 보임.
const MINIMAL_PRESET: SidebarMenuPreset = {
  id: "minimal",
  label: "최소",
  description: "카운터 + 내 정보 외 보조 항목 숨김. (권한이 허용된 경우)",
  config: {
    version: 1,
    order: [
      "counter",
      "me",
      "customers",
      "inventory",
      "payouts",
      "owner_home",
      "staff",
    ] as MenuItemId[],
    hidden: ["customers", "inventory", "payouts", "owner_home", "staff"] as MenuItemId[],
  },
}

// "운영자 중심" — 정산과 스태프를 상단으로 당김.
const OPERATOR_PRESET: SidebarMenuPreset = {
  id: "operator_focus",
  label: "운영자 중심",
  description: "정산 / 스태프 / 재고 를 상단으로. owner/manager 대상.",
  config: {
    version: 1,
    order: [
      "counter",
      "payouts",
      "staff",
      "inventory",
      "customers",
      "owner_home",
      "me",
    ] as MenuItemId[],
    hidden: [],
  },
}

export const SIDEBAR_MENU_PRESETS: readonly SidebarMenuPreset[] = [
  DEFAULT_PRESET,
  MINIMAL_PRESET,
  OPERATOR_PRESET,
] as const

export const SIDEBAR_MENU_PRESET_BY_ID: ReadonlyMap<string, SidebarMenuPreset> =
  new Map(SIDEBAR_MENU_PRESETS.map(p => [p.id, p]))
