"use client"

/**
 * RoomContext — Phase A scaffold (2026-04-18).
 *
 * Widget 분해를 준비하기 위한 단일 컨텍스트. RoomCardV2 가 현재 27 개의
 * props + 여러 로컬 useState + 여러 파생값을 인라인으로 계산하는데, 이
 * 데이터 모두를 하나의 context value 로 제공한다. 각 위젯(app/counter/
 * widgets/room/*) 은 props 0 으로 `useRoomContext()` 만 소비한다.
 *
 * Phase A 의 규칙
 *   - 기능 추가 없음. RoomCardV2 의 기존 prop/로컬 state/파생값 을 그대로
 *     반영하는 **읽기 전용 mirror** 이다.
 *   - 이 Provider 는 아직 아무 곳에서도 사용되지 않는다 (RoomCardV2 는
 *     그대로 유지).
 *   - Phase B 에서 RoomCardV2 가 이 Provider 로 감싸질 때 RoomCardV2 쪽
 *     계산을 제거하고 여기서 단일화한다.
 *
 * 구조
 *   Provider 입력 (inputs):
 *     - RoomCardV2 가 받던 props 전체
 *     - "내부 로컬 state" 도 명시적으로 상위에서 주입하는 shape 로 정의
 *       (useCounterModals 같은 훅과의 연결은 Phase B 에서 결정)
 *   Context value:
 *     - inputs + 파생값(isActive, hostesses, unresolvedCount, totals,
 *       dominantCategory, collapsedRemMs 등)
 *
 *   도메인 계산은 변경 없음 — RoomCardV2 에서 쓰던 함수 그대로 사용.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type {
  Room, FocusData, Participant, TimeBasis,
  OrderFormState, InventoryItem, Order,
} from "../types"
import type { HostessMatchCandidate } from "../helpers/hostessMatcher"
import type { AddHostessWithNameResult } from "../hooks/useParticipantMutations"
import {
  roomRemainingMs,
  EXTEND_MINUTES,
  type ExtendType,
} from "../helpers"
import type { InlineEditMode } from "../components/ParticipantInlineEditor"

// ── Callback shapes (RoomCardV2 의 onX prop 과 1:1 매칭) ─────────────

export type RoomInlineEditor = {
  onFocus: (room: Room) => void | Promise<void>
  onBlurFocus: () => void
  onToggleSelect: (id: string) => void
  onOpenSheet: (id: string, hint?: {
    storeName?: string | null
    category?: string | null
    timeMinutes?: number | null
    ticketType?: string | null
  }) => void
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
  onOpenMgrModal: () => void
  onSetBasis: (roomId: string, b: TimeBasis) => void
  onSetOrderOpen: (v: boolean | ((p: boolean) => boolean)) => void
  onSetOrderForm: (fn: (prev: OrderFormState) => OrderFormState) => void
  onAddOrder: () => void
  onDeleteOrder: (id: string) => void
  onQuickRepeatOrder: (o: Order) => void
  onEnsureSession: (roomId: string) => Promise<string | null>
  onRefreshAfterStaffChat?: (roomId: string, sessionId: string | null) => Promise<void>
  onOpenBulkManagerPicker?: (args: {
    roomId: string
    sessionId: string | null
    storeName: string
    participantIds: string[]
  }) => void
  onInlineEditParticipant?: (mode: InlineEditMode, participantId: string) => void
  onSwipeStart: (e: React.PointerEvent) => void
  onSwipeMove: (e: React.PointerEvent) => void
  onSwipeEnd: () => void
  onNavigate: (path: string) => void
  onOpenCustomerModal: () => void
  onInterimReceipt: () => void
}

// ── Input shape — provider 가 외부에서 받는 값 ───────────────────────

export type RoomContextInputs = RoomInlineEditor & {
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
  hostessNamePool?: HostessMatchCandidate[] | string[]
  /** Phase A 시점에는 부모 컴포넌트(RoomCardV2)가 로컬 useState 로 관리
   *  하는 값. Phase B 에서 Provider 로 lift 예정. 현재는 외부 주입으로만
   *  허용해서 위젯이 동일 JSX 를 렌더할 수 있게 한다. */
  extendOpen: boolean
  setExtendOpen: (v: boolean | ((p: boolean) => boolean)) => void
  staffChatValue: string
  setStaffChatValue: (v: string | ((p: string) => string)) => void
  staffChatSubmitting: boolean
  setStaffChatSubmitting: (v: boolean | ((p: boolean) => boolean)) => void
  staffChatError: string
  setStaffChatError: (v: string | ((p: string) => string)) => void
}

// ── Derived — 기존 RoomCardV2 inline 계산과 동일 ─────────────────────

export type RoomContextDerived = {
  isActive: boolean
  hostesses: Participant[]
  unresolvedCount: number
  hasUnresolved: boolean
  participantTotal: number
  orderTotal: number
  grandTotal: number
  collapsedRemMs: number
  catCounts: Record<string, number>
  cats: Array<[string, number]>
  dominantCategory: string
  dominantManagerMembershipId: string | null
  categoryMinutes: number
  expectedEndIso: string | null
  hostessCount: number
  customerPartySize: number
  totalHeadcount: number
  extendRef: Record<ExtendType, number>
}

export type RoomContextValue = RoomContextInputs & RoomContextDerived

const RoomContextInstance = createContext<RoomContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────

export function RoomProvider({
  value: inputs,
  children,
}: {
  value: RoomContextInputs
  children: ReactNode
}) {
  const derived = useMemo<RoomContextDerived>(() => {
    const { room, focusData, now } = inputs
    const isActive = room.session?.status === "active"
    const hostesses = focusData?.participants.filter(
      (p: Participant) => p.role === "hostess" && p.status === "active",
    ) ?? []
    const unresolvedCount = hostesses.filter(
      (p: Participant) => !p.category || !p.time_minutes,
    ).length
    const hasUnresolved = unresolvedCount > 0

    const participantTotal = focusData?.participants.reduce(
      (s: number, p: Participant) => s + (Number(p.price_amount) || 0),
      0,
    ) ?? 0
    const orderTotal = focusData?.orders.reduce(
      (s, o) => s + (Number(o.amount) || 0),
      0,
    ) ?? 0
    const grandTotal = (Number(participantTotal) || 0) + (Number(orderTotal) || 0)

    let collapsedRemMs = 0
    if (isActive && room.session) {
      collapsedRemMs = focusData && focusData.participants.length > 0
        ? roomRemainingMs(focusData.participants, now, room.session.started_at)
        : Math.max(0, new Date(room.session.started_at).getTime() + 60 * 60000 - now)
    }

    const catCounts = hostesses.reduce(
      (acc: Record<string, number>, h: Participant) => {
        const cat = typeof h.category === "string" ? h.category.trim() : ""
        if (!cat) return acc
        const prev = Number(acc[cat]) || 0
        acc[cat] = prev + 1
        return acc
      },
      {} as Record<string, number>,
    )
    const cats = Object.entries(catCounts)

    const dominantCategory = cats.length > 0
      ? cats.reduce((a, b) => a[1] >= b[1] ? a : b)[0]
      : "퍼블릭"

    const dominantManagerMembershipId: string | null = (() => {
      const counts = new Map<string, number>()
      for (const h of hostesses) {
        const mid = h.manager_membership_id
        if (mid) counts.set(mid, (counts.get(mid) ?? 0) + 1)
      }
      let best: string | null = null
      let bestN = 0
      for (const [mid, n] of counts.entries()) {
        if (n > bestN) { best = mid; bestN = n }
      }
      return best
    })()

    const categoryMinutes =
      dominantCategory === "퍼블릭" ? 90 :
      dominantCategory === "셔츠" ? 60 :
      dominantCategory === "하퍼" || dominantCategory === "하이퍼" ? 60 :
      90

    const expectedEndIso = room.session?.started_at
      ? new Date(new Date(room.session.started_at).getTime() + categoryMinutes * 60_000).toISOString()
      : null

    const hostessCount = Number(hostesses.length) || 0
    const customerPartySize = Number(room.session?.customer_party_size) || 0
    const totalHeadcount = customerPartySize + hostessCount

    const extendRef = EXTEND_MINUTES[dominantCategory] ?? EXTEND_MINUTES["퍼블릭"]

    return {
      isActive, hostesses, unresolvedCount, hasUnresolved,
      participantTotal, orderTotal, grandTotal,
      collapsedRemMs,
      catCounts, cats,
      dominantCategory, dominantManagerMembershipId,
      categoryMinutes, expectedEndIso,
      hostessCount, customerPartySize, totalHeadcount,
      extendRef,
    }
  }, [inputs])

  const value = useMemo<RoomContextValue>(() => ({ ...inputs, ...derived }), [inputs, derived])

  return (
    <RoomContextInstance.Provider value={value}>
      {children}
    </RoomContextInstance.Provider>
  )
}

export function useRoomContext(): RoomContextValue {
  const v = useContext(RoomContextInstance)
  if (!v) {
    throw new Error("useRoomContext must be used inside <RoomProvider>")
  }
  return v
}
