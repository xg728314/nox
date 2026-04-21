"use client"

/**
 * WidgetRenderer — manifest + layout 을 받아 위젯 JSX를 조립하는 순수
 * 렌더러. Phase A scaffold. 아직 RoomCardV2 에서 사용되지 않음.
 *
 * 렌더 파이프라인 (순서대로):
 *   1. layout.order 를 순회
 *   2. manifest 에서 정의를 찾는다 (없으면 건너뜀 — forward-compat)
 *   3. togglable=false 인 위젯은 hidden 에 있어도 강제 렌더
 *   4. togglable=true && hidden.has(id) → skip
 *   5. requiredRoles 제한이 있는데 현재 role 이 포함 안 되면 skip
 *   6. visibility hint 를 context 상태로 판정해서 skip/render
 *
 * Phase A 현재: context 는 외부에서 <RoomProvider> 로 제공된다고 가정.
 * 이 컴포넌트는 context 소비만 — 직접 inputs 를 받지 않는다.
 *
 * 동작 보장
 *   - 순서/hidden 은 layout 으로 제어
 *   - visibility 는 항상 강제 — 사용자가 숨길 수 없음 (예: collapsed_only
 *     는 expanded 뷰에서는 자동 숨김)
 *   - manifest 에 없는 widget id 는 조용히 무시 (이전 version 의 config
 *     이 남아있어도 crash 안 함)
 */

import { createElement, Fragment } from "react"
import {
  WIDGET_MANIFEST,
  WIDGET_BY_ID,
  type WidgetDefinition,
  type WidgetId,
  type WidgetRole,
  type WidgetVisibilityHint,
} from "../manifest"
import { DEFAULT_ROOM_LAYOUT, type RoomLayoutConfig } from "../layoutTypes"
import { useRoomContext, type RoomContextValue } from "../RoomContext"

export type WidgetRendererProps = {
  /** user_preferences 에서 로드한 설정. 없으면 DEFAULT_ROOM_LAYOUT. */
  layout?: RoomLayoutConfig
  /** role 필터링에 사용. 미지정 시 requiredRoles 체크는 skip. */
  role?: WidgetRole | null
  /** 디바이스 타입 — layout.perViewport 로부터 override 를 골라낼 때 사용. */
  viewport?: "pc" | "mobile"
}

export default function WidgetRenderer({
  layout = DEFAULT_ROOM_LAYOUT,
  role = null,
  viewport,
}: WidgetRendererProps) {
  const ctx = useRoomContext()
  const resolved = resolveLayout(layout, viewport)

  const rendered: React.ReactElement[] = []
  const seen = new Set<WidgetId>()

  for (const id of resolved.order) {
    if (seen.has(id)) continue                          // 중복 id 방어
    seen.add(id)
    const def = WIDGET_BY_ID.get(id)
    if (!def) continue                                  // forward-compat: 미지정 id 는 skip
    if (!shouldRender(def, resolved.hidden, role, ctx)) continue
    rendered.push(
      createElement(def.component, { key: def.id }),
    )
  }

  // layout.order 에 빠진 manifest 위젯은 기본 순서 뒤에 붙인다 (안전망).
  for (const def of WIDGET_MANIFEST) {
    if (seen.has(def.id)) continue
    if (!shouldRender(def, resolved.hidden, role, ctx)) continue
    rendered.push(createElement(def.component, { key: def.id }))
  }

  return createElement(Fragment, null, ...rendered)
}

// ── helpers ──────────────────────────────────────────────────────────

function resolveLayout(
  layout: RoomLayoutConfig,
  viewport: "pc" | "mobile" | undefined,
): { order: WidgetId[]; hidden: Set<WidgetId> } {
  const vpOverride = viewport && layout.perViewport?.[viewport]
  const order = (vpOverride?.order ?? layout.order).slice()
  const hiddenSet = new Set<WidgetId>(vpOverride?.hidden ?? layout.hidden)
  return { order, hidden: hiddenSet }
}

function shouldRender(
  def: WidgetDefinition,
  hidden: Set<WidgetId>,
  role: WidgetRole | null,
  ctx: RoomContextValue,
): boolean {
  // togglable=false → hidden 무시
  if (def.togglable && hidden.has(def.id)) return false
  // role 필터
  if (def.requiredRoles && def.requiredRoles.length > 0) {
    if (!role || !def.requiredRoles.includes(role)) return false
  }
  // visibility
  return passVisibility(def.visibility, ctx)
}

function passVisibility(hint: WidgetVisibilityHint, ctx: RoomContextValue): boolean {
  const { isFocused, isActive, selectedIds, focusData } = ctx
  // focusData 가 없을 때는 expand 영역을 렌더하지 않는다 — 원본
  // RoomCardV2 의 `isFocused && (isActive|!isActive) && focusData` 가드와
  // 동일한 의미. 헤더(collapsed/expanded)는 focusData 와 무관.
  switch (hint) {
    case "always":           return true
    case "collapsed_only":   return !isFocused
    case "expanded_only":    return isFocused
    case "active_expanded":  return isFocused && isActive && focusData != null
    case "empty_expanded":   return isFocused && !isActive && focusData != null
    case "selection_active": return isFocused && isActive && focusData != null && selectedIds.size > 0
    default:                 return false
  }
}
