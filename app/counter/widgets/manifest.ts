/**
 * WIDGET_MANIFEST — Phase A scaffold.
 *
 * 12 개 위젯의 메타데이터 단일 원본. 실제 컴포넌트는 room/* 에 위치.
 *
 * visibility 규칙 (context 소비 판정):
 *   - always           : 항상 렌더
 *   - collapsed_only   : !isFocused
 *   - expanded_only    : isFocused
 *   - active_expanded  : isFocused && isActive
 *   - empty_expanded   : isFocused && !isActive
 *   - selection_active : selectedIds.size > 0 (추가로 active_expanded 도 요구)
 *
 * togglable=false 위젯은 사용자가 hidden 에 넣어도 강제 렌더. 이유는
 * lockedReason 에 명시.
 */

import type { ComponentType } from "react"

import HeaderCollapsed    from "./room/HeaderCollapsed"
import HeaderExpanded     from "./room/HeaderExpanded"
import EmptyRoomPanel     from "./room/EmptyRoomPanel"
import OperationSummary   from "./room/OperationSummary"
import TimeBasisToggle    from "./room/TimeBasisToggle"
import ExtendPanel        from "./room/ExtendPanel"
import SelectionBar       from "./room/SelectionBar"
import StaffChatInputWidget from "./room/StaffChatInputWidget"
import ActionRow          from "./room/ActionRow"
import OrderBlock         from "./room/OrderBlock"
import ParticipantList    from "./room/ParticipantList"
import TotalsCheckout     from "./room/TotalsCheckout"

export type WidgetId =
  | "header_collapsed"
  | "header_expanded"
  | "empty_room_panel"
  | "operation_summary"
  | "time_basis_toggle"
  | "extend_panel"
  | "selection_bar"
  | "staff_chat_input"
  | "action_row"
  | "order_block"
  | "participant_list"
  | "totals_checkout"

export type WidgetVisibilityHint =
  | "always"
  | "collapsed_only"
  | "expanded_only"
  | "active_expanded"
  | "empty_expanded"
  | "selection_active"

export type WidgetGroup =
  | "header"
  | "operation"
  | "list"
  | "order"
  | "action"
  | "totals"

export type WidgetRole = "owner" | "manager" | "waiter" | "staff"

export type WidgetDefinition = {
  id: WidgetId
  label: string
  group: WidgetGroup
  component: ComponentType
  visibility: WidgetVisibilityHint
  togglable: boolean
  lockedReason?: string
  requiredRoles?: ReadonlyArray<WidgetRole>
}

export const WIDGET_MANIFEST: readonly WidgetDefinition[] = [
  {
    id: "header_collapsed", label: "방 헤더(접힘)", group: "header",
    component: HeaderCollapsed, visibility: "collapsed_only",
    togglable: false, lockedReason: "방 식별에 필요",
  },
  {
    id: "header_expanded", label: "방 헤더(펼침)", group: "header",
    component: HeaderExpanded, visibility: "expanded_only",
    togglable: false, lockedReason: "방 식별에 필요",
  },
  {
    id: "empty_room_panel", label: "빈 방 패널", group: "operation",
    component: EmptyRoomPanel, visibility: "empty_expanded",
    togglable: false, lockedReason: "빈 방에서 진입할 UI 가 없으면 운영 불가",
  },
  {
    id: "operation_summary", label: "운영 요약 (인원/시간)", group: "operation",
    component: OperationSummary, visibility: "active_expanded",
    togglable: true,
  },
  {
    id: "time_basis_toggle", label: "시간 기준 토글", group: "operation",
    component: TimeBasisToggle, visibility: "active_expanded",
    togglable: true,
  },
  {
    id: "extend_panel", label: "연장 패널", group: "operation",
    component: ExtendPanel, visibility: "active_expanded",
    togglable: true,
  },
  {
    id: "selection_bar", label: "선택 바", group: "operation",
    component: SelectionBar, visibility: "selection_active",
    togglable: false, lockedReason: "다중 선택 처리에 필요",
  },
  {
    id: "staff_chat_input", label: "스태프 채팅 입력", group: "list",
    component: StaffChatInputWidget, visibility: "active_expanded",
    togglable: true,
  },
  {
    id: "action_row", label: "액션 버튼 (+스태프/+주문/계산)", group: "action",
    component: ActionRow, visibility: "active_expanded",
    togglable: false, lockedReason: "계산 진입점",
  },
  {
    id: "order_block", label: "주류/주문 블록", group: "order",
    component: OrderBlock, visibility: "active_expanded",
    togglable: true,
  },
  {
    id: "participant_list", label: "참여자 목록", group: "list",
    component: ParticipantList, visibility: "active_expanded",
    togglable: false, lockedReason: "운영 핵심 정보",
  },
  {
    id: "totals_checkout", label: "합계 + 체크아웃", group: "totals",
    component: TotalsCheckout, visibility: "active_expanded",
    togglable: false, lockedReason: "체크아웃 진입점",
  },
] as const

export const WIDGET_BY_ID: ReadonlyMap<WidgetId, WidgetDefinition> = new Map(
  WIDGET_MANIFEST.map(w => [w.id, w]),
)
