/**
 * layoutTypes — RoomLayoutConfig + DEFAULT_ROOM_LAYOUT (Phase A scaffold).
 *
 * 사용자별 user_preferences.scope="counter.room_layout" JSON 의 타입
 * contract. Phase A 에서는 스키마만 정의하고, 실제 저장/로드(useRoomLayout
 * 훅 + /api/me/preferences 라우트)는 Phase C 에서 구현한다.
 */

import type { WidgetId } from "./manifest"

export type RoomLayoutConfig = {
  version: 1
  /** 렌더 순서 — 미포함 widget id 는 기본 순서 뒤쪽에 자동 붙는다. */
  order: WidgetId[]
  /** 사용자가 숨긴 togglable widget. togglable=false 위젯은 무시된다. */
  hidden: WidgetId[]
  /** viewport 별 override — 지정되지 않은 viewport 는 상위 order/hidden 사용. */
  perViewport?: {
    pc?:     { order?: WidgetId[]; hidden?: WidgetId[] }
    mobile?: { order?: WidgetId[]; hidden?: WidgetId[] }
  }
}

export const DEFAULT_ROOM_LAYOUT: RoomLayoutConfig = {
  version: 1,
  order: [
    "header_collapsed",
    "header_expanded",
    "empty_room_panel",
    "operation_summary",
    "time_basis_toggle",
    "extend_panel",
    "selection_bar",
    "staff_chat_input",
    "action_row",
    "order_block",
    "participant_list",
    "totals_checkout",
  ],
  hidden: [],
}
