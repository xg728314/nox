/**
 * Room layout presets — ready-made RoomLayoutConfig shapes that the user
 * can apply to their editor draft with one click. Persistence still uses
 * the existing `setLayout` flow; presets only mutate the in-progress
 * draft until the user explicitly saves.
 *
 * Presets respect the same normalization rules the editor enforces at
 * save time: unknown ids are silently dropped, hidden list is filtered
 * to togglable ids only. So even a preset author cannot bypass locked
 * widgets.
 */

import type { RoomLayoutConfig } from "@/app/counter/widgets/layoutTypes"
import { DEFAULT_ROOM_LAYOUT } from "@/app/counter/widgets/layoutTypes"
import type { WidgetId } from "@/app/counter/widgets/manifest"

export type RoomLayoutPreset = {
  id: string
  label: string
  description?: string
  config: RoomLayoutConfig
}

// "기본" — manifest 기본 순서 + 숨김 없음.
const DEFAULT_PRESET: RoomLayoutPreset = {
  id: "default",
  label: "기본",
  description: "manifest 기본 순서. 모든 위젯 표시.",
  config: DEFAULT_ROOM_LAYOUT,
}

// "컴팩트" — 보조 정보 위젯을 숨겨서 카드 높이 최소화. togglable 위젯만
// hidden 에 포함 (필수 위젯은 자동 무시됨).
const COMPACT_ORDER: WidgetId[] = [
  "header_collapsed",
  "header_expanded",
  "empty_room_panel",
  "selection_bar",
  "action_row",
  "order_block",
  "participant_list",
  "totals_checkout",
  "operation_summary",
  "time_basis_toggle",
  "extend_panel",
  "staff_chat_input",
]
const COMPACT_PRESET: RoomLayoutPreset = {
  id: "compact",
  label: "컴팩트",
  description: "보조 위젯(요약/시간기준/연장/채팅) 숨김. 필수 + 주문/참여자/합계만.",
  config: {
    version: 1,
    order: COMPACT_ORDER,
    hidden: ["operation_summary", "time_basis_toggle", "extend_panel", "staff_chat_input"],
  },
}

// "주문 중심" — order_block 을 상단에 가깝게 배치. 숨김 없음.
const ORDER_FOCUS_ORDER: WidgetId[] = [
  "header_collapsed",
  "header_expanded",
  "empty_room_panel",
  "operation_summary",
  "order_block",
  "action_row",
  "participant_list",
  "time_basis_toggle",
  "extend_panel",
  "selection_bar",
  "staff_chat_input",
  "totals_checkout",
]
const ORDER_FOCUS_PRESET: RoomLayoutPreset = {
  id: "order_focus",
  label: "주문 중심",
  description: "주문 블록 + 액션 + 참여자를 상단에 배치. 주류 판매 집중 운영용.",
  config: {
    version: 1,
    order: ORDER_FOCUS_ORDER,
    hidden: [],
  },
}

export const ROOM_LAYOUT_PRESETS: readonly RoomLayoutPreset[] = [
  DEFAULT_PRESET,
  COMPACT_PRESET,
  ORDER_FOCUS_PRESET,
] as const

export const ROOM_LAYOUT_PRESET_BY_ID: ReadonlyMap<string, RoomLayoutPreset> =
  new Map(ROOM_LAYOUT_PRESETS.map(p => [p.id, p]))
