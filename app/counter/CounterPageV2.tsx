"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import CounterBleMinimapWidget from "./components/CounterBleMinimapWidget"
import type {
  Room,
  TimeBasis, StaffItem,
  SheetState, MgrModalState, InventoryItem,
  ViewMode,
} from "./types"
import { SHEET_INIT, MGR_MODAL_INIT, VIEW_MODE_STORAGE_KEY } from "./types"
import RoomCardV2 from "./components/RoomCardV2"
import ParticipantSetupSheetV2 from "./components/ParticipantSetupSheetV2"
import BulkManagerPickerV2 from "./components/BulkManagerPickerV2"
import ParticipantInlineEditor, { type InlineEditMode, type InlineEditCommit } from "./components/ParticipantInlineEditor"
import ManagerChangeModalV2 from "./components/ManagerChangeModalV2"
import CustomerModal from "./components/CustomerModal"
import ClosedRoomCardV2 from "./components/ClosedRoomCardV2"
import CounterSidebar from "./components/CounterSidebar"
import InterimModeModal from "./components/InterimModeModal"
import CreditSection from "./components/CreditSection"
import AccountSelectTrigger from "./components/AccountSelectTrigger"
import CreditSettlementModal from "./components/CreditSettlementModal"
import PcCounterLayout from "./components/PcCounterLayout"
import MobileCounterLayout from "./components/MobileCounterLayout"
import * as counterApi from "./services/counterApi"
import type { HostessMatchCandidate } from "./helpers/hostessMatcher"
import { useRooms } from "./hooks/useRooms"
import { useFocusedSession } from "./hooks/useFocusedSession"
import { useOrderMutations } from "./hooks/useOrderMutations"
import { useParticipantMutations } from "./hooks/useParticipantMutations"
import { useCheckoutFlow } from "./hooks/useCheckoutFlow"
import { useCounterModals } from "./hooks/useCounterModals"
import { useParticipantEditFlow } from "./hooks/useParticipantEditFlow"
import { useCreditFlow } from "./hooks/useCreditFlow"
import { useAccountSelectionFlow } from "./hooks/useAccountSelectionFlow"
import { useCreditSettlementFlow } from "./hooks/useCreditSettlementFlow"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

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
  const [unreadChat, setUnreadChat] = useState(0)

  // ── View mode (UI-only: AUTO / PC / MOBILE)
  // NO business logic touches this — only the layout shell that wraps the
  // rooms list and the overall page container are affected.
  const [viewMode, setViewMode] = useState<ViewMode>("auto")
  const [autoIsMobile, setAutoIsMobile] = useState<boolean>(false)
  const effectiveMode: "pc" | "mobile" =
    viewMode === "auto" ? (autoIsMobile ? "mobile" : "pc") : viewMode
  function applyViewMode(m: ViewMode) {
    setViewMode(m)
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, m) } catch { /* ignore */ }
  }
  const [busy, setBusy] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  // orderForm / order handlers owned by useOrderMutations (destructured below).

  // ── Inventory (items loaded for order picker)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])

  // ── Hostess stats
  const [hostessStats, setHostessStats] = useState<{
    managed_total: number; on_duty_count: number; waiting_count: number; in_room_count: number; scope: string
  } | null>(null)

  // Hostess candidate pool — structured rows from /api/store/staff?role=hostess
  // enriched branch. Used for read-only context-aware name-match suggestions
  // on newly created participants. Populated once on mount; never mutated by
  // participant operations. Pool type is `HostessMatchCandidate[] | string[]`
  // — if the endpoint returns only plain names (older version / enrichment
  // failure), the matcher falls back to name-only scoring.
  // SAFE: pool is display-side metadata only.
  const [hostessNamePool, setHostessNamePool] = useState<HostessMatchCandidate[] | string[]>([])

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

  // Wire realtime → focus refetch (hook owns subscription; page owns focus state).
  useEffect(() => {
    setOnRealtimeEvent((table: "room_sessions" | "session_participants" | "orders") => {
      if ((table === "room_sessions" || table === "session_participants" || table === "orders") &&
          focusRoomId && focusData?.sessionId) {
        fetchFocusData(focusRoomId, focusData.sessionId, focusData.started_at)
      }
    })
    return () => setOnRealtimeEvent(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRoomId, focusData?.sessionId])

  // fetchOrders / fetchFocusData are owned by useFocusedSession.

  async function fetchUnreadChat() {
    try {
      const total = await counterApi.fetchChatUnreadTotal()
      setUnreadChat(total)
    } catch { /* ignore */ }
  }

  async function fetchInventory() {
    try {
      const items = await counterApi.fetchInventoryItems<InventoryItem>()
      setInventoryItems(items)
    } catch { /* ignore */ }
  }

  async function fetchHostessStats() {
    try {
      const d = await counterApi.fetchHostessStats<{
        managed_total: number
        on_duty_count: number
        waiting_count: number
        in_room_count: number
        scope: string
      }>()
      if (d) setHostessStats(d)
    } catch { /* ignore */ }
  }

  // Best-effort hostess candidate fetch for read-only match suggestions.
  // Tries to consume the enriched branch (structured HostessMatchCandidate
  // rows with manager/activity context). Falls back to a plain string[]
  // when the endpoint hasn't been enriched yet (forward-compat). Failure
  // is non-fatal — pool stays empty and matcher returns NONE.
  async function fetchHostessPool() {
    try {
      const list = await counterApi.fetchHostessPool()
      if (list.length === 0) { setHostessNamePool([]); return }
      // Detect structured rows (enriched branch).
      const structured = list.every(
        (r) => typeof r?.membership_id === "string" && typeof r?.name === "string"
      )
      if (structured) {
        const seen = new Set<string>()
        const out: HostessMatchCandidate[] = []
        for (const r of list) {
          const mid = String(r.membership_id ?? "")
          if (!mid || seen.has(mid)) continue
          seen.add(mid)
          const name = typeof r.name === "string" ? r.name : ""
          const normalized_name =
            typeof r.normalized_name === "string" && r.normalized_name.length > 0
              ? r.normalized_name
              : name.replace(/\s+/g, "").trim()
          out.push({
            membership_id: mid,
            name,
            normalized_name,
            store_uuid: (typeof r.store_uuid === "string" ? r.store_uuid : null),
            store_name: (typeof r.store_name === "string" ? r.store_name : null),
            manager_membership_id:
              typeof r.manager_membership_id === "string" ? r.manager_membership_id : null,
            manager_name:
              typeof r.manager_name === "string" ? r.manager_name : null,
            is_active_today:
              typeof r.is_active_today === "boolean" ? r.is_active_today : null,
            recent_assignment_score:
              typeof r.recent_assignment_score === "number" ? r.recent_assignment_score : null,
          })
        }
        setHostessNamePool(out)
      } else {
        // Legacy/plain shape — fall back to name strings.
        const names = Array.from(
          new Set(
            list
              .map((s) => (typeof s?.name === "string" ? (s.name as string).trim() : ""))
              .filter((n): n is string => n.length > 0)
          )
        )
        setHostessNamePool(names)
      }
    } catch { /* ignore */ }
  }

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
    focusRoomId, focusData, fetchRooms, fetchFocusData, setBusy, setError,
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
  async function openBulkManagerPicker(args: {
    roomId: string
    sessionId: string | null
    storeName: string
    participantIds: string[]
  }) {
    if (!args.storeName || args.participantIds.length === 0) return
    setBulkMgr({
      open: true,
      storeName: args.storeName,
      storeUuid: null,
      managerList: [],
      participantIds: args.participantIds,
      roomId: args.roomId,
      sessionId: args.sessionId,
      busy: false,
    })
    try {
      const { staff, store_uuid } = await counterApi.fetchManagersForStore(args.storeName)
      setBulkMgr(s => ({
        ...s,
        managerList: staff,
        storeUuid: store_uuid,
      }))
    } catch { /* leave empty list — UI surfaces it */ }
  }

  // Apply one manager to every id in the bulk batch. Uses the existing
  // fillUnspecified PATCH dispatch (triggered by membership_id: null),
  // passing only manager_membership_id so category/time_minutes on the
  // row are preserved (fillUnspecified coalesces missing body fields to
  // the participant's current row values — see
  // lib/session/services/participantActions/fillUnspecified.ts).
  // bulkAssignManager now lives in useParticipantEditFlow (flow.bulkAssignManager).

  function closeBulkManagerPicker() {
    if (bulkMgr.busy) return
    setBulkMgr({
      open: false, storeName: "", storeUuid: null, managerList: [],
      participantIds: [], roomId: null, sessionId: null, busy: false,
    })
  }

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

  async function openMgrModal() {
    try {
      const { staff } = await counterApi.fetchManagersForStore(null)
      patchMgr({ open: true, staffList: staff })
    } catch { patchMgr({ open: true }) }
  }

  async function handleSaveManager() {
    if (!focusData) return
    const body: Record<string, unknown> = {}
    if (mgr.isExternal) {
      if (!mgr.externalName.trim()) { setError("실장 이름을 입력하세요"); return }
      body.is_external_manager = true
      body.manager_name = mgr.externalOrg.trim()
        ? `${mgr.externalOrg.trim()} ${mgr.externalName.trim()}`
        : mgr.externalName.trim()
      body.manager_membership_id = null
    } else if (mgr.selected) {
      body.is_external_manager = false
      body.manager_name = mgr.selected.name
      body.manager_membership_id = mgr.selected.membership_id
    } else {
      setError("실장을 선택하세요"); return
    }
    setBusy(true)
    try {
      const sessionId = await ensureSession(focusData.roomId)
      if (!sessionId) return
      const result = await counterApi.patchSession(sessionId, body)
      if (!result.ok) { const d = result.data as { message?: string }; setError(d?.message || "실장 변경 실패"); return }
      setMgr(MGR_MODAL_INIT)
      await fetchRooms()
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  // ── Inventory ──

  // ── Customer ──

  type CustomerItem = { id: string; name: string; phone: string | null; memo: string | null }

  async function searchCustomers(q: string): Promise<CustomerItem[]> {
    try {
      return await counterApi.searchCustomers<CustomerItem>(q)
    } catch { return [] }
  }

  async function createCustomer(data: { name: string; phone?: string }): Promise<CustomerItem | null> {
    try {
      const result = await counterApi.createCustomer(data)
      if (!result.ok) { const d = result.data as { message?: string }; setError(d?.message || "손님 등록 실패"); return null }
      const d = result.data as { customer?: CustomerItem; message?: string } & CustomerItem
      // /api/customers 응답은 { customer: {...} } 또는 flat — 기존 로직과 동일하게 flat raw 반환
      return (d?.customer ?? (d as unknown as CustomerItem)) ?? null
    } catch { setError("요청 오류"); return null }
  }

  async function handleSaveCustomer(data: {
    customer_id: string | null
    customer_name_snapshot: string
    customer_party_size: number
  }) {
    if (!focusData) return
    setBusy(true); setError("")
    try {
      const sessionId = await ensureSession(focusData.roomId)
      if (!sessionId) return
      const result = await counterApi.patchSession(sessionId, data as unknown as Record<string, unknown>)
      if (!result.ok) { const d = result.data as { message?: string }; setError(d?.message || "손님 정보 저장 실패"); return }
      setCustomerModalOpen(false)
      await fetchRooms()
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

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

  useEffect(() => {
    // Auth is enforced by middleware.ts (cookie-based). Data fetches
    // will surface 401 from the server if the session is missing.
    fetchRooms()
    fetchUnreadChat()
    fetchInventory()
    fetchHostessStats()
    fetchHostessPool()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-focus: if rendered via `/counter/<room_id>` the page parent passes
  // `initialRoomId`. Wait for rooms to load, find the match, enter focus.
  // Fires once per initialRoomId change and skips if the room is already
  // focused (stable against re-renders).
  useEffect(() => {
    if (!initialRoomId) return
    if (focusRoomId === initialRoomId) return
    if (!rooms || rooms.length === 0) return
    const match = rooms.find(r => r.id === initialRoomId)
    if (match) {
      void enterFocus(match)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId, rooms, focusRoomId])

  // View mode: load persisted choice + subscribe to viewport width for AUTO.
  // No business logic here — pure UI preference persistence.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
      if (saved === "auto" || saved === "pc" || saved === "mobile") {
        setViewMode(saved as ViewMode)
      }
    } catch { /* ignore */ }
    const mq = window.matchMedia("(max-width: 768px)")
    setAutoIsMobile(mq.matches)
    const onMQ = (e: MediaQueryListEvent) => setAutoIsMobile(e.matches)
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onMQ)
      return () => mq.removeEventListener("change", onMQ)
    } else {
      // Safari <14 fallback
      const legacy = mq as MediaQueryList & {
        addListener?: (cb: (e: MediaQueryListEvent) => void) => void
        removeListener?: (cb: (e: MediaQueryListEvent) => void) => void
      }
      legacy.addListener?.(onMQ)
      return () => legacy.removeListener?.(onMQ)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (customerModalOpen) { setCustomerModalOpen(false); return }
      if (mgr.open) { setMgr(MGR_MODAL_INIT); return }
      if (sheet.open) { setSheet(SHEET_INIT); return }
      if (sidebarOpen) { setSidebarOpen(false); return }
      if (focusRoomId) { exitFocus(); return }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerModalOpen, mgr.open, sheet.open, sidebarOpen, focusRoomId])

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
            <button onClick={() => router.push("/chat")} className="relative text-slate-400 hover:text-white">
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
export default function CounterPage() {
  return <CounterPageV2 />
}
