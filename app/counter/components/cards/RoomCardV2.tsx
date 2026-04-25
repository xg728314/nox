"use client"

/**
 * RoomCardV2 — Phase B.
 *
 * 과거에는 820 LOC god component 였지만 이제는 widget scaffold 의 얇은
 * 어댑터다. 내부 JSX/로직은 전부 `app/counter/widgets/` 로 이동:
 *   - outer wrapper (isActive 색상, isFocused ring) → RoomShell
 *   - 12개 layer JSX → widgets/room/* (manifest 로 등록)
 *   - 순서/가시성 → DEFAULT_ROOM_LAYOUT + WidgetRenderer
 *
 * Phase A 규칙에 따라 UI/동작/callback/스타일 모두 기존과 동일하다.
 * 이 컴포넌트는 단지:
 *   1. 부모로부터 받은 모든 prop 을 RoomContextInputs 로 매핑
 *   2. 기존에 RoomCardV2 가 보유하던 4 개 로컬 state (extendOpen,
 *      staffChatValue/Submitting/Error) 를 이곳에서 그대로 선언 — Phase A
 *      의 RoomContextInputs 도 이를 외부 주입 받는 shape 로 정의해 두었다.
 *   3. RoomShell 로 감싸 WidgetRenderer 에 DEFAULT_ROOM_LAYOUT 을 전달.
 *
 * 결과적으로 렌더 트리는 기존과 동일:
 *   - Header (collapsed/expanded) — 항상
 *   - Empty room panel — isFocused && !isActive && focusData
 *   - Operation summary / time basis / extend panel / selection bar /
 *     staff chat / action row / order block / participant list /
 *     totals checkout — isFocused && isActive && focusData
 *
 * 부모(CounterPageV2 / RoomCardV2 를 사용하는 모든 곳)의 API 는 한 줄도
 * 변경하지 않는다 — Props 타입 / prop 이름 / 콜백 시그니처 모두 유지.
 */

import { useMemo, useState } from "react"
import type {
  Room, FocusData, TimeBasis, OrderFormState, InventoryItem, Order,
} from "../../types"
import type { ExtendType } from "../../helpers"
import type { AddHostessWithNameResult } from "../../hooks/useParticipantMutations"
import type { HostessMatchCandidate } from "../../helpers/hostessMatcher"
import type { InlineEditMode } from "../ParticipantInlineEditor"
import RoomShell from "../../widgets/RoomShell"
import WidgetRenderer from "../../widgets/renderer/WidgetRenderer"
import { useRoomLayout } from "../../hooks/useRoomLayout"
import type { RoomContextInputs } from "../../widgets/RoomContext"

type Props = {
  room: Room
  isFocused: boolean
  focusData: FocusData | null
  basis: TimeBasis
  now: number
  currentStoreUuid: string | null
  selectedIds: Set<string>
  busy: boolean
  orderOpen: boolean
  orderForm: OrderFormState
  inventoryItems: InventoryItem[]
  swipeX: number
  onFocus: (room: Room) => void | Promise<void>
  onBlurFocus: () => void
  onToggleSelect: (id: string) => void
  onOpenSheet: (
    id: string,
    hint?: {
      storeName?: string | null
      category?: string | null
      timeMinutes?: number | null
      ticketType?: string | null
    }
  ) => void
  onOpenBulkManagerPicker?: (args: {
    roomId: string
    sessionId: string | null
    storeName: string
    participantIds: string[]
  }) => void
  onInlineEditParticipant?: (mode: InlineEditMode, participantId: string) => void
  onNameBlur: (id: string, cur: string | null | undefined, next: string) => Promise<void>
  onMidOut: (id: string) => void
  onDeleteParticipant: (id: string) => void
  onExtendRoom: (type: ExtendType, participantIds?: string[]) => void
  onAddHostess: () => void
  onAddHostessWithName?: (args: {
    external_name: string
    session_id?: string | null
    origin_store_name?: string | null
    category?: string | null
    ticket_type?: string | null
  }) => Promise<AddHostessWithNameResult>
  hostessNamePool?: HostessMatchCandidate[] | string[]
  onOpenMgrModal: () => void
  onSetBasis: (roomId: string, b: TimeBasis) => void
  onSetOrderOpen: (v: boolean | ((p: boolean) => boolean)) => void
  onSetOrderForm: (fn: (prev: OrderFormState) => OrderFormState) => void
  onAddOrder: () => void
  onDeleteOrder: (id: string) => void
  onQuickRepeatOrder: (o: Order) => void
  onEnsureSession: (roomId: string) => Promise<string | null>
  onRefreshAfterStaffChat?: (roomId: string, sessionId: string | null) => Promise<void>
  onSwipeStart: (e: React.PointerEvent) => void
  onSwipeMove: (e: React.PointerEvent) => void
  onSwipeEnd: () => void
  onNavigate: (path: string) => void
  onOpenCustomerModal: () => void
  onInterimReceipt: () => void
}

export default function RoomCardV2(props: Props) {
  // ── 기존 RoomCardV2 로컬 state 보존 ────────────────────────────────
  // Phase A 의 RoomContextInputs 는 이 4개 state 를 외부 주입 받는 shape
  // 로 정의되어 있다. 시작점을 바꾸지 않기 위해 여기서 그대로 선언.
  const [extendOpen, setExtendOpen] = useState(false)
  const [staffChatValue, setStaffChatValue] = useState("")
  const [staffChatSubmitting, setStaffChatSubmitting] = useState(false)
  const [staffChatError, setStaffChatError] = useState<string>("")
  // 2026-04-25: 방 카드 내 외상 등록 모달 open state.
  const [creditModalOpen, setCreditModalOpen] = useState(false)

  // Phase C — user_preferences 기반 layout. 저장값이 없으면 훅 내부에서
  // DEFAULT_ROOM_LAYOUT 을 반환하므로 기본 렌더 결과는 Phase B 와 동일.
  const { layout } = useRoomLayout(props.currentStoreUuid)

  // ── Props + local state → RoomContextInputs 매핑 ──────────────────
  const value = useMemo<RoomContextInputs>(() => ({
    // inputs
    room: props.room,
    isFocused: props.isFocused,
    focusData: props.focusData,
    basis: props.basis,
    now: props.now,
    currentStoreUuid: props.currentStoreUuid,
    selectedIds: props.selectedIds,
    busy: props.busy,
    orderOpen: props.orderOpen,
    orderForm: props.orderForm,
    inventoryItems: props.inventoryItems,
    swipeX: props.swipeX,
    hostessNamePool: props.hostessNamePool,
    // local state (Phase A shape — 외부 주입으로 취급)
    extendOpen, setExtendOpen,
    staffChatValue, setStaffChatValue,
    staffChatSubmitting, setStaffChatSubmitting,
    staffChatError, setStaffChatError,
    creditModalOpen, setCreditModalOpen,
    // callbacks (1:1 매핑, 변경 없음)
    onFocus: props.onFocus,
    onBlurFocus: props.onBlurFocus,
    onToggleSelect: props.onToggleSelect,
    onOpenSheet: props.onOpenSheet,
    onNameBlur: props.onNameBlur,
    onMidOut: props.onMidOut,
    onDeleteParticipant: props.onDeleteParticipant,
    onExtendRoom: props.onExtendRoom,
    onAddHostess: props.onAddHostess,
    onAddHostessWithName: props.onAddHostessWithName,
    onOpenMgrModal: props.onOpenMgrModal,
    onSetBasis: props.onSetBasis,
    onSetOrderOpen: props.onSetOrderOpen,
    onSetOrderForm: props.onSetOrderForm,
    onAddOrder: props.onAddOrder,
    onDeleteOrder: props.onDeleteOrder,
    onQuickRepeatOrder: props.onQuickRepeatOrder,
    onEnsureSession: props.onEnsureSession,
    onRefreshAfterStaffChat: props.onRefreshAfterStaffChat,
    onOpenBulkManagerPicker: props.onOpenBulkManagerPicker,
    onInlineEditParticipant: props.onInlineEditParticipant,
    onSwipeStart: props.onSwipeStart,
    onSwipeMove: props.onSwipeMove,
    onSwipeEnd: props.onSwipeEnd,
    onNavigate: props.onNavigate,
    onOpenCustomerModal: props.onOpenCustomerModal,
    onInterimReceipt: props.onInterimReceipt,
  }), [props, extendOpen, staffChatValue, staffChatSubmitting, staffChatError, creditModalOpen])

  return (
    <RoomShell value={value}>
      <WidgetRenderer layout={layout} />
    </RoomShell>
  )
}
