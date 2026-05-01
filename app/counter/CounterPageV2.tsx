"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useIdleLogout } from "@/lib/security/useIdleLogout"
import CounterBleMinimapWidget from "./components/CounterBleMinimapWidget"
import DailyOpsCheckGate from "@/components/DailyOpsCheckGate"
import type {
  Room,
  TimeBasis, StaffItem,
  SheetState, MgrModalState, InventoryItem,
  ViewMode,
} from "./types"
import { SHEET_INIT, MGR_MODAL_INIT, VIEW_MODE_STORAGE_KEY } from "./types"
import RoomCardV2 from "./components/cards/RoomCardV2"
import ParticipantSetupSheetV2 from "./components/modals/ParticipantSetupSheetV2"
import BulkManagerPickerV2 from "./components/modals/BulkManagerPickerV2"
import ParticipantInlineEditor, { type InlineEditMode, type InlineEditCommit } from "./components/ParticipantInlineEditor"
import ManagerChangeModalV2 from "./components/modals/ManagerChangeModalV2"
import CustomerModal from "./components/modals/CustomerModal"
import ClosedRoomCardV2 from "./components/cards/ClosedRoomCardV2"
import CounterSidebar from "./components/CounterSidebar"
import InterimModeModal from "./components/modals/InterimModeModal"
import CreditSection from "./components/CreditSection"
import AccountSelectTrigger from "./components/AccountSelectTrigger"
import CreditSettlementModal from "./components/modals/CreditSettlementModal"
import PcCounterLayout from "./components/layouts/PcCounterLayout"
import MobileCounterLayout from "./components/layouts/MobileCounterLayout"
import * as counterApi from "./services/counterApi"
import type { HostessMatchCandidate } from "./helpers/hostessMatcher"
import { useRooms } from "./hooks/useRooms"
import { useFocusedSession } from "./hooks/useFocusedSession"
import { useCounterBootstrap } from "./hooks/useCounterBootstrap"
import { useViewMode } from "./hooks/useViewMode"
import { useCustomerFlow } from "./hooks/useCustomerFlow"
import { useManagerChangeFlow } from "./hooks/useManagerChangeFlow"
import { useBulkManagerPicker } from "./hooks/useBulkManagerPicker"
import { useEscapeStack } from "./hooks/useEscapeStack"
import { useRealtimePatchWiring } from "./hooks/useRealtimePatchWiring"
import { useOrderMutations } from "./hooks/useOrderMutations"
import { useParticipantMutations } from "./hooks/useParticipantMutations"
import { useCheckoutFlow } from "./hooks/useCheckoutFlow"
import { useCounterModals } from "./hooks/useCounterModals"
import { useParticipantEditFlow } from "./hooks/useParticipantEditFlow"
import { useCreditFlow } from "./hooks/useCreditFlow"
import { useAccountSelectionFlow } from "./hooks/useAccountSelectionFlow"
import { useCreditSettlementFlow } from "./hooks/useCreditSettlementFlow"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { apiFetch } from "@/lib/apiFetch"
import { usePagePerf } from "@/lib/debug/usePagePerf"

// ─── Component ───────────────────────────────────────────────────────────────

export type CounterPageV2Props = {
  /** When set, CounterPageV2 auto-focuses the given room after rooms load.
   *  Used by `app/counter/[room_id]/page.tsx` so that the legacy
   *  `/counter/<room_id>` URL keeps working without a duplicate page. */
  initialRoomId?: string
}

// Next.js page default-export constraint requires the default export to
// match PageProps. CounterPageV2 itself takes a custom `initialRoomId`,
// so we expose it as a named export and provide a thin `CounterPage`
// default wrapper that Next can consume at `/counter`.
export function CounterPageV2({ initialRoomId }: CounterPageV2Props = {}) {
  const router = useRouter()
  // 2026-04-24: 카운터 PC 방치 시 30분 무조작 → 자동 로그아웃.
  useIdleLogout({ onLogout: () => router.push("/login?idle=1") })
  // ── BLE monitor embed toggle (STEP: embedded panel round)
  //   When true, render <MonitorPanel variant="embedded" /> inside this page
  //   instead of navigating to /counter/monitor. The standalone route still
  //   works for deep-linking and the ops-analytics back-link.
  const [showBle, setShowBle] = useState(false)

  // ── Core data (rooms/dailySummary/realtime/polling lifted into useRooms hook)
  const {
    rooms,
    setRooms,
    dailySummary,
    currentStoreUuid,
    loading,
    now,
    refreshRooms: fetchRooms,
    setOnRealtimeEvent,
  } = useRooms()
  const [error, setError] = useState("")

  // R29-refactor: bootstrap + 4 fetch 함수를 useCounterBootstrap 으로 이전.
  //   chat_unread / inventory / hostess_stats / hostess_pool 모두 한 훅에서 관리.
  const {
    chatUnread, setChatUnread: setUnreadChat,
    inventoryItems, hostessStats, hostessNamePool,
    fetchInventory,
  } = useCounterBootstrap()
  // 기존 코드 호환을 위한 alias
  const unreadChat = chatUnread

  // Chat 버튼 중복 클릭 방지 + 실패 시 재시도 허용.
  const [chatBusy, setChatBusy] = useState(false)

  // ── Focus (owned by useFocusedSession)
  const {
    focusRoomId, setFocusRoomId,
    focusData, setFocusData,
    focusCache, setFocusCache,
    fetchOrders, fetchFocusData,
  } = useFocusedSession()
  const [timeBasis, setTimeBasis] = useState<Record<string, TimeBasis>>({})

  // ── UI
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // role 은 서버-인증된 프로필에서 읽는다. 과거 localStorage 기반 role 은
  // UI 스푸핑이 가능했기 때문에 R-1 fix 이후로는 사용하지 않는다.
  const currentProfile = useCurrentProfile()
  const currentRole = currentProfile?.role ?? null

  // 2026-05-01 R-Hostess-Home: page-level guard.
  //   middleware 가 hostess / staff role → /me/home redirect 하지만,
  //   super_admin override cookie / stale client cache 대비 이중 안전망.
  //   "스태프" (NOX 한국어 wording) 는 staff + hostess 두 role 모두 포함.
  //   둘 다 차단 → /me/home (내 방 + 채팅 + DM + 일한 갯수).
  //
  //   isStaffRole 일 때는 페이지 본문 자체를 렌더 안 함 (방/매출/사이드바
  //   가 잠깐이라도 깜빡 노출되지 않도록 early-return).
  const isStaffRole =
    currentProfile?.role === "hostess" || currentProfile?.role === "staff"
  useEffect(() => {
    if (isStaffRole) {
      router.replace("/me/home")
    }
  }, [isStaffRole, router])

  // R29-refactor: viewMode 는 useViewMode 훅으로 이전.
  const { viewMode, effectiveMode, applyViewMode } = useViewMode()

  const [busy, setBusy] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  // orderForm / order handlers owned by useOrderMutations (destructured below).
  // chatUnread / inventoryItems / hostessStats / hostessNamePool 은 useCounterBootstrap.

  // ── Modal / sheet state (owned by useCounterModals) ─────────────────
  // sheet, mgr, bulkMgr, inlineEdit, customerModalOpen 을 단일 훅으로 묶어
  // CounterPageV2 의 useState 표면을 5 → 0 으로 줄였다. 동작/초기값은
  // 기존과 동일.
  const {
    sheet, setSheet, patchSheet,
    mgr, setMgr, patchMgr,
    bulkMgr, setBulkMgr,
    inlineEdit, setInlineEdit,
    customerModalOpen, setCustomerModalOpen,
  } = useCounterModals()

  // Swipe-to-checkout state owned by useCheckoutFlow.

  // ═══ Fetchers ═════════════════════════════════════════════════════════════════
  // Note: fetchRooms / currentStoreUuid / dailySummary / realtime / polling (now)
  // are owned by useRooms(). This page calls `fetchRooms()` = refreshRooms alias.

  // Wire realtime → focus state PATCH (realtime patch-mode round).
  //
  //   Before: every event triggered fetchFocusData → full refetch of
  //     /api/rooms/{id}/participants + /api/sessions/orders.
  //     BLE ingest bursts produced participants×5, orders×5 stacks
  //     visible in the Network tab.
  //
  //   After: Supabase CDC payload includes the full row (RLS disabled).
  //     We apply an in-memory patch keyed by row.id and filtered to the
  //     currently-focused session. Patch runs in setFocusData, so render
  //     consistency is guaranteed.
  //
  //   Fallback: if the payload does not match the focused session OR
  //     the row shape is unexpected (e.g. partial payload from a server
  //     upgrade), we fall back to fetchFocusData for that event. This
  //     keeps the UI correct even under unknown payloads.
  // R29-refactor: realtime patch 흐름은 useRealtimePatchWiring 훅으로 이전.
  useRealtimePatchWiring({
    focusRoomId, focusData, setFocusData,
    setOnRealtimeEvent, fetchFocusData,
  })

  // fetchOrders / fetchFocusData are owned by useFocusedSession.
  // fetchUnreadChat / fetchInventory / fetchHostessStats / fetchHostessPool /
  //   processHostessPool 은 R29 에서 useCounterBootstrap 훅으로 이전.

  // ═══ Session + participant edit flow (hook-owned) ══════════════════════════════
  // ensureSession / handleInlineCommit / handleSheetCommit / bulkAssignManager
  // 는 전부 useParticipantEditFlow 가 관리한다. 본 페이지에서는 훅이 반환한
  // 함수만 render 부에서 전달.
  const flow = useParticipantEditFlow({
    focusData, setFocusData,
    fetchRooms, fetchFocusData,
    setBusy, setError,
    sheet, setSheet, patchSheet,
    bulkMgr, setBulkMgr,
    inlineEdit, setInlineEdit,
    currentStoreUuid,
  })
  const ensureSession = flow.ensureSession
  const handleInlineCommit = flow.handleInlineCommit
  const handleSheetCommit = flow.handleSheetCommit
  const bulkAssignManager = flow.bulkAssignManager


  // ═══ Mutation hooks ═══════════════════════════════════════════════════════════

  const {
    orderForm, setOrderForm,
    handleAddOrder, handleQuickRepeatOrder, handleDeleteOrder,
  } = useOrderMutations({
    focusData, setFocusData, fetchOrders, fetchRooms, fetchInventory,
    ensureSession, setBusy, setError, setOrderOpen,
  })

  const {
    selectedIds, setSelectedIds,
    handleAddHostess, handleMidOut, handleExtendRoom,
    handleAddHostessWithName,
    handleNameBlur, handleDeleteUnsetParticipant,
  } = useParticipantMutations({
    focusRoomId, focusData, fetchRooms, fetchFocusData, setFocusData, setBusy, setError,
  })

  // ═══ Focus enter / exit ═══════════════════════════════════════════════════════

  async function enterFocus(room: Room) {
    setFocusRoomId(room.id)
    setSelectedIds(new Set())
    setOrderOpen(false)
    if (!room.session?.id) {
      setFocusData({
        roomId: room.id, sessionId: "", started_at: "",
        session_status: "empty", participants: [], orders: [], loading: false,
      })
      return
    }
    setFocusData({
      roomId: room.id, sessionId: room.session.id,
      started_at: room.session.started_at, session_status: room.session.status,
      participants: [], orders: [], loading: true,
    })
    await fetchFocusData(room.id, room.session.id, room.session.started_at)
  }

  function exitFocus() {
    setFocusRoomId(null)
    setFocusData(null)
    setSelectedIds(new Set())
    setOrderOpen(false)
  }

  // ═══ Bottom sheet ═════════════════════════════════════════════════════════════

  function openSheetForEdit(
    participantId: string,
    hint?: {
      storeName?: string | null
      /** Explicit category from the caller (e.g. parser output) — takes
       *  precedence over `focusData` lookup, which may be stale
       *  immediately after a refresh+open sequence before React flushes. */
      category?: string | null
      /** Explicit time_minutes from the caller (e.g. ticketToPreset
       *  result from the POST body). Same precedence rule as category. */
      timeMinutes?: number | null
      /** Parser ticket label — persisted into sheet.ticketType so the
       *  category step can recompute time via ticketToPreset. (BUG 3) */
      ticketType?: string | null
    },
  ) {
    // When the caller already knows which store the participant belongs
    // to (e.g. StaffChatInput parsed "라미도 퍼 완메" → 라이브), skip the
    // store-picker step. If the caller also supplies category +
    // timeMinutes (common for staff-chat single-entry auto-open), we land
    // on the manager step directly — NO category re-pick, preserving the
    // POST-time (퍼블릭→90 / 셔츠→60 / 하퍼→60) value written by the
    // server. Fallback chain for each field:
    //   hint.* (authoritative, never stale)
    //   → focusData participant row (may be stale right after mutation)
    //   → null
    const p = focusData?.participants.find(x => x.id === participantId)
    const VALID_CATS = ["퍼블릭", "셔츠", "하퍼"] as const
    const hintedCat: SheetState["category"] =
      hint?.category && (VALID_CATS as readonly string[]).includes(hint.category)
        ? (hint.category as SheetState["category"])
        : null
    const rowCat = (p?.category as SheetState["category"]) ?? null
    const cat: SheetState["category"] = hintedCat ?? rowCat
    const hintedTm =
      typeof hint?.timeMinutes === "number" && hint.timeMinutes > 0
        ? hint.timeMinutes
        : null
    const tm = hintedTm ?? p?.time_minutes ?? null
    const ticketType = hint?.ticketType?.trim() || null
    const storeHint = hint?.storeName?.trim() || null
    if (storeHint) {
      const initStep: SheetState["step"] = cat ? "manager" : "category"
      setSheet({
        ...SHEET_INIT,
        open: true,
        participantId,
        store: storeHint,
        category: cat,
        timeMinutes: tm,
        step: initStep,
        isStoreAutoResolved: true,
        ticketType,
      })
      void loadManagersForStore(storeHint)
      return
    }
    setSheet({
      ...SHEET_INIT,
      open: true,
      participantId,
      category: cat,
      timeMinutes: tm,
      ticketType,
    })
  }

  async function loadManagersForStore(storeName: string) {
    try {
      const { staff, store_uuid } = await counterApi.fetchManagersForStore(storeName)
      patchSheet({ managerList: staff, storeUuid: store_uuid })
    } catch { patchSheet({ managerList: [] }) }
  }

  // ── Bulk manager picker — open + bulk-assign ────────────────────────
  //
  // Called by RoomCardV2 after a multi-entry staff-chat submit that
  // resolved an exact store. Loads the store's manager list, then shows
  // BulkManagerPickerV2 with the N newly-created participant ids.
  // R29-refactor: bulk picker 모달 open/close 는 useBulkManagerPicker 로 이전.
  //   bulkAssignManager 자체는 useParticipantEditFlow (flow.bulkAssignManager).
  const { openBulkManagerPicker, closeBulkManagerPicker } = useBulkManagerPicker({
    bulkMgr, setBulkMgr,
  })

  // ── Inline editor: entry point + commit ────────────────────────────
  function openInlineEdit(mode: InlineEditMode, participantId: string) {
    setError("")
    setInlineEdit({ mode, participantId, busy: false })
  }

  function closeInlineEdit() {
    if (inlineEdit?.busy) return
    setInlineEdit(null)
  }

  // handleInlineCommit / handleSheetCommit now live in
  // useParticipantEditFlow (flow.handleInlineCommit / flow.handleSheetCommit).

  // ═══ Action handlers ══════════════════════════════════════════════════════════

  async function handleAddRoom() {
    setBusy(true); setError("")
    try {
      const result = await counterApi.createRoom()
      const data = result.data as { message?: string }
      if (!result.ok) { setError(data.message || "방 추가 실패"); return }
      await fetchRooms()
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  // handleAddHostess / handleNameBlur / handleDeleteUnsetParticipant
  // handleMidOut / handleExtendRoom — all owned by useParticipantMutations.

  // handleCheckout / handleInterimReceipt / createInterimReceipt /
  // handleClosedRoomClick / swipe state owned by useCheckoutFlow.
  const {
    interimModalOpen, setInterimModalOpen,
    handleCheckout, handleInterimReceipt, createInterimReceipt, handleClosedRoomClick,
    swipeX, onSwipeStart, onSwipeMove, onSwipeEnd,
  } = useCheckoutFlow({
    focusData,
    fetchRooms,
    exitFocus,
    setBusy,
    setError,
  })

  // Credit (외상) flow owned by useCreditFlow.
  const {
    creditModalOpen, creditForm, managerList: creditManagerList, submitting: creditSubmitting,
    openCreditModal, closeCreditModal, updateCreditForm, submitCredit,
  } = useCreditFlow({
    focusData,
    fetchRooms,
    setError,
  })

  // Account selection owned by useAccountSelectionFlow.
  const {
    modalOpen: accountModalOpen,
    accounts: accountList,
    sharedAccounts: accountSharedList,
    loading: accountLoading,
    pickedId: accountPickedId,
    selectedAccount,
    mode: accountMode,
    manualInput: accountManualInput,
    openModal: openAccountModal,
    closeModal: closeAccountModal,
    pickAccount,
    setMode: setAccountMode,
    setManualInput: setAccountManualInput,
    confirmSelection: confirmAccountSelection,
  } = useAccountSelectionFlow({ setError })

  // Credit ↔ account 연결 흐름 owned by useCreditSettlementFlow.
  const {
    modalOpen: creditSettlementModalOpen,
    credits: creditSettlementCredits,
    loading: creditSettlementLoading,
    error: creditSettlementError,
    selectedCreditId,
    submitting: creditSettlementSubmitting,
    openModal: openCreditSettlementModal,
    closeModal: closeCreditSettlementModal,
    selectCredit,
    confirmLink: confirmCreditLink,
  } = useCreditSettlementFlow({ setError })

  // handleAddOrder / handleQuickRepeatOrder / handleDeleteOrder owned by useOrderMutations.

  // ── Manager modal ──

  // R29-refactor: manager change 모달 흐름은 useManagerChangeFlow 로 이전.
  const { openMgrModal, handleSaveManager } = useManagerChangeFlow({
    focusData, mgr, setMgr, patchMgr,
    ensureSession, fetchRooms, setBusy, setError,
  })

  // ── Inventory ──

  // ── Customer ──

  // R29-refactor: customer 흐름은 useCustomerFlow 로 이전.
  const { searchCustomers, createCustomer, handleSaveCustomer } = useCustomerFlow({
    focusData, ensureSession, fetchRooms,
    setCustomerModalOpen, setBusy, setError,
  })

  // ── Selection / swipe ──

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // swipe handlers owned by useCheckoutFlow.

  // ═══ Effects ══════════════════════════════════════════════════════════════════

  usePagePerf("counter")

  // R29-refactor: rooms 만 여기서 fetch. bootstrap (4 slots) 은 useCounterBootstrap 이 처리.
  useEffect(() => {
    fetchRooms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-focus: if rendered via `/counter/<room_id>` the page parent passes
  // `initialRoomId`. Wait for rooms to load, find the match, enter focus.
  //
  // 2026-04-24 FIX: 한 initialRoomId 당 정확히 1 회만 auto-focus 한다.
  //   이전 버전은 deps 에 focusRoomId 가 들어 있어서, 사용자가 다른 방을
  //   클릭해 focusRoomId 가 바뀌면 이 effect 가 다시 발화 → initialRoomId
  //   로 focus 를 강제로 되돌렸다. 결과적으로 /counter/<room_id> 경로에서
  //   다른 방 선택이 불가능한 상태가 됨. autoFocusedRef 로 "이미 처리한
  //   initialRoomId" 를 기록해 재진입을 막는다.
  const autoFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialRoomId) return
    if (autoFocusedRef.current === initialRoomId) return
    if (!rooms || rooms.length === 0) return
    const match = rooms.find(r => r.id === initialRoomId)
    if (!match) return
    autoFocusedRef.current = initialRoomId
    void enterFocus(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId, rooms])

  // R29-refactor: viewMode persistence + viewport listener 는 useViewMode 훅으로 이전.

  // R29-refactor: ESC 키 처리는 useEscapeStack 으로 이전.
  useEscapeStack({
    customerModalOpen,
    closeCustomerModal: () => setCustomerModalOpen(false),
    mgrOpen: mgr.open,
    closeMgrModal: () => setMgr(MGR_MODAL_INIT),
    sheetOpen: sheet.open,
    closeSheet: () => setSheet(SHEET_INIT),
    sidebarOpen,
    closeSidebar: () => setSidebarOpen(false),
    focusRoomId,
    exitFocus,
  })

  // (polling + realtime subscription are owned by useRooms)

  // ═══ Derived ══════════════════════════════════════════════════════════════════

  // All rooms always show in main area (rooms are fixed slots)
  // Rooms with closed_session but no active session → shown as empty + appear in closed grid
  const activeCount = rooms.filter(r => r.session?.status === "active").length
  const emptyCount = rooms.filter(r => !r.session).length
  const closedRooms = rooms.filter(r => !r.session && !!r.closed_session)
  const closedCount = closedRooms.length

  // ── Live KPI from rooms state (not from receipts/daily report)
  const liveGrossTotal = rooms.reduce((sum, r) => sum + (r.session?.gross_total ?? 0), 0)
  const liveOrderTotal = rooms.reduce((sum, r) => sum + (r.session?.order_total ?? 0), 0)

  // ═══ Loading ══════════════════════════════════════════════════════════════════

  // 2026-05-01 R-Hostess-Home: staff/hostess 면 본문 렌더 차단 (redirect 진행 중).
  //   useEffect 의 router.replace 가 끝나기 전에 방/매출 잠깐이라도 노출 X.
  if (isStaffRole) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex items-center justify-center">
        <div className="text-slate-400 text-sm">스태프 home 으로 이동 중...</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex items-center justify-center">
        <div className="text-cyan-400 text-sm animate-pulse">로딩 중...</div>
      </div>
    )
  }

  // ═══ Render ═══════════════════════════════════════════════════════════════════

  return (
    <div
      className="min-h-screen bg-[#0a0c14] text-white antialiased"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif', WebkitFontSmoothing: "antialiased", letterSpacing: "-0.01em" }}
    >

      {/* ─── Sidebar (extracted into CounterSidebar) ───────────────────────── */}
      {/* Sidebar stays OUTSIDE the mobile-centered container because it uses
          position:fixed; wrapping it inside max-w-[420px] with a transform
          ancestor would constrain the slide-over to the centered column —
          operators opening the menu in mobile-preview mode expect normal
          slide-over behavior in their actual viewport. */}
      <CounterSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        rooms={rooms}
        dailySummary={dailySummary}
        currentRole={currentRole}
        onNavigate={(path) => router.push(path)}
        focused={!!focusData}
        selectedAccount={selectedAccount}
        onOpenAccountPicker={openAccountModal}
        onOpenCreditSettlement={openCreditSettlementModal}
        onOpenCreditRegister={openCreditModal}
      />

      {/* ─── View-mode outer wrapper ───────────────────────────────────────
          MOBILE: center the whole page content at 420px so Header + stats +
                  main layout all render at mobile width (not just rooms).
          PC/AUTO→PC: no-op wrapper (display: contents-equivalent). */}
      <div
        className={
          effectiveMode === "mobile"
            ? "mx-auto max-w-[420px] min-h-screen border-x border-white/[0.08] shadow-[0_0_40px_rgba(0,0,0,0.5)]"
            : ""
        }
      >

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-slate-300 hover:text-white text-xl" aria-label="메뉴">☰</button>
            <span className="text-base font-bold tracking-tight">카운터</span>
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.9)]" />
              운영중
            </span>
            <span className="text-[12px] text-cyan-300 font-semibold">{activeCount}/{rooms.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle (AUTO / PC / MOBILE) — UI only */}
            <div
              className="flex items-center rounded-lg bg-white/[0.05] border border-white/10 p-0.5 text-[10px] font-semibold"
              role="group"
              aria-label="보기 모드"
            >
              {(["auto", "pc", "mobile"] as const).map((m) => {
                const active = viewMode === m
                const label = m === "auto" ? "AUTO" : m === "pc" ? "PC" : "MOBILE"
                return (
                  <button
                    key={m}
                    onClick={() => applyViewMode(m)}
                    aria-pressed={active}
                    title={
                      m === "auto"
                        ? `AUTO (현재: ${effectiveMode.toUpperCase()})`
                        : label
                    }
                    className={`px-2 py-1 rounded transition-colors ${
                      active
                        ? "bg-cyan-500/20 text-cyan-300"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {/* BLE 모니터 인라인 토글 — 풀페이지 이동 대신 같은 화면 내
                임베디드 패널을 열고 닫는다. 길게 누르면(alt/ctrl+click)
                기존 /counter/monitor 풀페이지로 이동할 수 있도록 보조
                경로를 유지한다. */}
            <button
              onClick={(e) => {
                if (e.altKey || e.ctrlKey || e.metaKey) {
                  router.push("/counter/monitor")
                  return
                }
                setShowBle((v) => !v)
              }}
              aria-pressed={showBle}
              title={showBle ? "BLE 모니터 닫기 (Alt+클릭: 풀페이지)" : "BLE 모니터 열기 (Alt+클릭: 풀페이지)"}
              className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors ${
                showBle
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                  : "bg-white/[0.05] text-slate-400 border-white/10 hover:text-slate-200"
              }`}
            >
              BLE 모니터
            </button>
            <button
              onClick={async () => {
                if (chatBusy) return
                // 1순위: explicit focus (focusData.sessionId)
                // 2순위: focus 미지정 시 rooms[] 에서 active session 을 찾는다.
                //   - 정확히 1개 → 자동으로 그 session 으로 room_session chat
                //   - 2개 이상 (ambiguous) 또는 0개 → /chat 리스트 fallback
                //   state 는 이미 useRooms().rooms 로 보유. 추가 호출 없음.
                let sid: string | null = focusData?.sessionId ?? null
                if (!sid) {
                  const actives = (rooms ?? []).filter(
                    (r) => !!r.session?.id && r.session?.status === "active",
                  )
                  if (actives.length === 1) {
                    sid = actives[0].session!.id ?? null
                  }
                }
                if (!sid) {
                  router.push("/chat")
                  return
                }
                setChatBusy(true)
                try {
                  const res = await apiFetch("/api/chat/rooms", {
                    method: "POST",
                    body: JSON.stringify({ type: "room_session", session_id: sid }),
                  })
                  const d = (await res.json().catch(() => ({}))) as {
                    chat_room_id?: string
                    error?: string
                    message?: string
                  }
                  if (!res.ok || !d.chat_room_id) {
                    // 실패 시 existing error UI 재사용.
                    setError(
                      d.message ||
                        d.error ||
                        `채팅방 생성 실패 (${res.status})`,
                    )
                    // fallback: 리스트로 보내서 사용자 막다른 느낌 최소화.
                    router.push("/chat")
                    return
                  }
                  router.push(`/chat/${d.chat_room_id}`)
                } catch {
                  setError("채팅방 생성 실패 — 네트워크 오류")
                  router.push("/chat")
                } finally {
                  setChatBusy(false)
                }
              }}
              disabled={chatBusy}
              className="relative text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-wait"
              title={(() => {
                if (focusData?.sessionId) return "현재 룸 채팅 열기 (room_session)"
                const activeCount = (rooms ?? []).filter(
                  (r) => !!r.session?.id && r.session?.status === "active",
                ).length
                if (activeCount === 1) return "진행 중인 룸 채팅 열기 (room_session)"
                if (activeCount > 1) return `채팅 목록 (진행 중 세션 ${activeCount}개 — 한 룸을 선택하세요)`
                return "채팅 목록 (진행 중 세션 없음)"
              })()}
            >
              <span className="text-lg">💬</span>
              {unreadChat > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {unreadChat > 9 ? "9+" : unreadChat}
                </span>
              )}
            </button>
            <span className="text-slate-500 text-sm">🔔</span>
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">E</div>
          </div>
        </div>
      </div>

      {/* ─── Hostess stats bar ─────────────────────────────────────────── */}
      {hostessStats && hostessStats.managed_total > 0 && (
        <div className="px-4 py-1.5 bg-[#0d1020]/80 border-b border-white/[0.05] flex items-center gap-3">
          <span className="text-[10px] text-slate-500">{hostessStats.scope === "manager" ? "내 관리" : "매장"}</span>
          <div className="flex items-center gap-2.5 text-[11px]">
            <span className="text-slate-400">총인원 <span className="text-cyan-300 font-bold">{hostessStats.managed_total}</span></span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">출근 <span className="text-emerald-400 font-bold">{hostessStats.on_duty_count}</span></span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">대기 <span className="text-amber-300 font-bold">{hostessStats.waiting_count}</span></span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">접객 <span className="text-red-300 font-bold">{hostessStats.in_room_count}</span></span>
          </div>
        </div>
      )}

      {error && <div className="mx-3 mt-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}

      {/* ─── BLE 미니맵 위젯 ──────────────────────────────────────────────
          운영용 컴팩트 위젯. 스코프 선택(내 가게/현재 층/5F-8F), 접기/
          펼치기, 실시간 인디케이터를 자체적으로 관리한다. 고정 높이
          불필요 — 위젯이 스스로 크기를 결정한다. 상세는
          app/counter/components/CounterBleMinimapWidget.tsx 참조. */}
      {showBle && (
        <div className="mx-3 mt-2">
          <CounterBleMinimapWidget />
        </div>
      )}

      {/* ─── Main layout — AUTO/PC: split with right rail · MOBILE: centered 420px ───
          The rooms content (map + add button + closed grid) is IDENTICAL in both
          modes. Only the wrapping shell differs. RoomCardV2 prop contract is
          byte-identical across modes — zero business-logic change. */}
      {(() => {
        const mainContent = (
          <>
            {/* All rooms (fixed slots — always visible) */}
            <div className="flex flex-col gap-2">
              {rooms.map(room => (
                <RoomCardV2
                  key={room.id}
                  room={room}
                  isFocused={focusRoomId === room.id}
                  focusData={focusRoomId === room.id ? focusData : (focusCache[room.id] ?? null)}
                  basis={(timeBasis[room.id] || "room") as TimeBasis}
                  now={now}
                  currentStoreUuid={currentStoreUuid}
                  selectedIds={selectedIds}
                  busy={busy}
                  orderOpen={orderOpen}
                  orderForm={orderForm}
                  swipeX={swipeX}
                  onFocus={enterFocus}
                  onBlurFocus={exitFocus}
                  onToggleSelect={toggleSelect}
                  onOpenSheet={openSheetForEdit}
                  onNameBlur={handleNameBlur}
                  onMidOut={handleMidOut}
                  onDeleteParticipant={handleDeleteUnsetParticipant}
                  onExtendRoom={handleExtendRoom}
                  onAddHostess={handleAddHostess}
                  onAddHostessWithName={handleAddHostessWithName}
                  hostessNamePool={hostessNamePool}
                  onOpenMgrModal={openMgrModal}
                  onSetBasis={(rid, b) => setTimeBasis(p => ({ ...p, [rid]: b }))}
                  onSetOrderOpen={setOrderOpen}
                  onSetOrderForm={fn => setOrderForm(fn)}
                  onAddOrder={handleAddOrder}
                  onDeleteOrder={handleDeleteOrder}
                  onQuickRepeatOrder={handleQuickRepeatOrder}
                  onEnsureSession={ensureSession}
                  onOpenBulkManagerPicker={(args) => openBulkManagerPicker(args)}
                  onInlineEditParticipant={openInlineEdit}
                  onRefreshAfterStaffChat={async (roomId, sessionId) => {
                    // Immediate post-staff-chat refresh: refetch rooms
                    // so headcount/totals/timer update, then (if we know
                    // the session) refetch focus data so the participant
                    // list shows the newly-created cards. Runs in parallel
                    // where safe; failure is silent — next poll catches up.
                    await fetchRooms()
                    if (sessionId) {
                      const sa = focusData?.sessionId === sessionId ? focusData.started_at : ""
                      await fetchFocusData(roomId, sessionId, sa ?? "")
                    }
                  }}
                  inventoryItems={inventoryItems}
                  onSwipeStart={onSwipeStart}
                  onSwipeMove={onSwipeMove}
                  onSwipeEnd={onSwipeEnd}
                  onNavigate={path => router.push(path)}
                  onOpenCustomerModal={() => setCustomerModalOpen(true)}
                  onInterimReceipt={handleInterimReceipt}
                />
              ))}

              {/* Add room button */}
              <button
                onClick={handleAddRoom}
                disabled={busy}
                className="w-full py-2.5 rounded-2xl border border-dashed border-white/15 text-slate-500 text-sm hover:border-white/30 hover:text-slate-300 transition-all disabled:opacity-40"
              >
                + 방 추가
              </button>
            </div>

            {/* Closed rooms section — tighter grid in mobile preview */}
            {closedRooms.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-[10px] text-slate-500 font-semibold">완료</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 font-medium">
                    {closedCount}건
                  </span>
                </div>
                <div className={`grid ${effectiveMode === "mobile" ? "grid-cols-3" : "grid-cols-4"} gap-1.5`}>
                  {closedRooms.map(room => (
                    <ClosedRoomCardV2
                      key={`closed-${room.id}`}
                      room={room}
                      onClickClosed={handleClosedRoomClick}
                      onReopened={() => { void fetchRooms() }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )
        return effectiveMode === "mobile"
          ? <MobileCounterLayout>{mainContent}</MobileCounterLayout>
          : <PcCounterLayout>{mainContent}</PcCounterLayout>
      })()}

      </div>
      {/* ─── End view-mode outer wrapper ─── */}

      {/* ─── Bottom sheet ────────────────────────────────────────────────── */}
      {sheet.open && (
        <ParticipantSetupSheetV2
          sheet={sheet}
          onPatch={patchSheet}
          onClose={() => setSheet(SHEET_INIT)}
          onLoadManagers={loadManagersForStore}
          onCommit={handleSheetCommit}
        />
      )}

      {/* ─── Bulk manager picker (multi-entry staff-chat) ─────────────── */}
      {bulkMgr.open && (
        <BulkManagerPickerV2
          open={bulkMgr.open}
          storeName={bulkMgr.storeName}
          managerList={bulkMgr.managerList}
          participantIds={bulkMgr.participantIds}
          busy={bulkMgr.busy}
          onClose={closeBulkManagerPicker}
          onAssignSame={bulkAssignManager}
        />
      )}

      {/* ─── Participant inline editor (5-mode popover) ──────────────── */}
      {inlineEdit && (
        <ParticipantInlineEditor
          open={!!inlineEdit}
          mode={inlineEdit.mode}
          participant={
            focusData?.participants.find(p => p.id === inlineEdit.participantId) ?? null
          }
          currentStoreUuid={currentStoreUuid}
          currentStoreName={null}
          busy={inlineEdit.busy}
          onClose={closeInlineEdit}
          onCommit={handleInlineCommit}
        />
      )}

      {/* ─── Manager modal ───────────────────────────────────────────────── */}
      {mgr.open && (
        <ManagerChangeModalV2
          mgr={mgr}
          busy={busy}
          onPatch={patchMgr}
          onClose={() => setMgr(MGR_MODAL_INIT)}
          onSave={handleSaveManager}
        />
      )}

      {/* ─── Customer modal ─────────────────────────────────────────────── */}
      {customerModalOpen && focusRoomId && (() => {
        const focusRoom = rooms.find(r => r.id === focusRoomId)
        return (
          <CustomerModal
            currentName={focusRoom?.session?.customer_name_snapshot ?? null}
            currentPartySize={focusRoom?.session?.customer_party_size ?? 0}
            busy={busy}
            onClose={() => setCustomerModalOpen(false)}
            onSave={handleSaveCustomer}
            onSearch={searchCustomers}
            onCreate={createCustomer}
          />
        )
      })()}

      <InterimModeModal
        open={interimModalOpen}
        focusData={focusData}
        busy={busy}
        onClose={() => setInterimModalOpen(false)}
        onSelectElapsed={() => createInterimReceipt("elapsed")}
        onSelectHalf={() => createInterimReceipt("half_ticket")}
      />

      <CreditSection
        focused={!!focusData}
        open={creditModalOpen}
        busy={creditSubmitting}
        form={creditForm}
        managers={creditManagerList}
        onOpen={openCreditModal}
        onClose={closeCreditModal}
        onChange={updateCreditForm}
        onSubmit={submitCredit}
      />

      <AccountSelectTrigger
        visible={!!focusData}
        modalOpen={accountModalOpen}
        loading={accountLoading}
        accounts={accountList}
        sharedAccounts={accountSharedList}
        pickedId={accountPickedId}
        selectedAccount={selectedAccount}
        mode={accountMode}
        manualInput={accountManualInput}
        onOpen={openAccountModal}
        onClose={closeAccountModal}
        onPick={pickAccount}
        onSetMode={setAccountMode}
        onSetManualInput={setAccountManualInput}
        onConfirm={confirmAccountSelection}
      />

      {/* STEP: 수금 floating button moved into CounterSidebar's bottom
          action section. The modal host stays here. */}
      <CreditSettlementModal
        open={creditSettlementModalOpen}
        loading={creditSettlementLoading}
        error={creditSettlementError}
        submitting={creditSettlementSubmitting}
        credits={creditSettlementCredits}
        selectedCreditId={selectedCreditId}
        linkedAccount={selectedAccount}
        onSelectCredit={selectCredit}
        onClose={closeCreditSettlementModal}
        onCollect={() => confirmCreditLink("collect", selectedAccount?.id ?? null)}
        onCancel={() => confirmCreditLink("cancel")}
        onOpenAccountPicker={openAccountModal}
      />

    </div>
  )
}

// Default export shim — Next.js page route compatibility. `/counter/page.tsx`
// re-exports this; it must accept zero props to satisfy Next's PageProps.
//
// ROUND-OPS-2: 하루 1회 운영 체크 게이트 — overlay 로 추가.
export default function CounterPage() {
  return (
    <>
      <CounterPageV2 />
      <DailyOpsCheckGate />
    </>
  )
}
