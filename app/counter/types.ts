// ─── Shared types for counter page ──────────────────────────────────────────

export type SessionInfo = {
  id: string
  status: string
  started_at: string
  ended_at?: string | null
  participant_count: number
  gross_total: number
  participant_total?: number
  order_total?: number
  manager_name?: string | null
  customer_name_snapshot?: string | null
  customer_party_size?: number | null
}

export type Room = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session?: SessionInfo | null
  closed_session?: SessionInfo | null
}

export type Participant = {
  id: string
  membership_id: string | null
  external_name?: string | null
  role: string
  category: string | null
  time_minutes: number
  price_amount: number
  cha3_amount?: number
  banti_amount?: number
  waiter_tip_received?: boolean
  waiter_tip_amount?: number
  origin_store_uuid?: string | null
  /** Human-readable store label resolved from origin_store_uuid, joined
   *  on the server (see app/api/rooms/[room_uuid]/participants/route.ts).
   *  Rendered next to manager in the participant card row 2 so operators
   *  can see the parsed affiliation at a glance. */
  origin_store_name?: string | null
  status: string
  entered_at: string
  name?: string
  manager_membership_id?: string | null
  manager_name?: string | null
  match_status?: "matched" | "review_needed" | "unmatched" | null
  match_candidates?: string[]
  name_edited?: boolean
}

export type Order = {
  id: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  amount: number
  store_price?: number
  sale_price?: number
  manager_amount?: number
  customer_amount?: number
}

export type InventoryItem = {
  id: string
  name: string
  category: string
  unit: string
  current_stock: number
  min_stock: number
  unit_cost: number
  store_price?: number
  is_active: boolean
  is_low_stock?: boolean
  is_out_of_stock?: boolean
}

export type DailySummary = {
  total_sessions: number
  gross_total: number
  order_total: number
  participant_total: number
}

export type FocusData = {
  roomId: string
  sessionId: string
  started_at: string
  session_status: string
  participants: Participant[]
  orders: Order[]
  loading: boolean
}

export type TimeBasis = "room" | "individual"

// ─── View mode toggle (UI-only) ─────────────────────────────────────────────
// AUTO : follow viewport width (<=768px → mobile, else pc)
// PC   : force desktop layout regardless of viewport
// MOBILE: force mobile preview (centered ~420px column) — lets devs view the
//         mobile layout on a PC without resizing the window.
// No business logic touches this value. It only picks which layout shell
// wraps the rooms section.
export type ViewMode = "auto" | "pc" | "mobile"
export const VIEW_MODE_STORAGE_KEY = "nox_counter_view_mode"

export type StaffItem = {
  membership_id: string
  name: string
  role: string
}

// Bank account shape returned by GET /api/me/bank-accounts.
// Kept minimal — no server-only fields exposed to the UI.
export type BankAccount = {
  id: string
  bank_name: string
  account_number: string
  holder_name: string
  is_default: boolean
  is_active: boolean
  is_shared?: boolean
}

// ─── State shapes (shared between container + components) ───────────────────

export type SheetState = {
  open: boolean
  step: "store" | "category" | "manager"
  store: string
  storeUuid: string | null
  category: "퍼블릭" | "셔츠" | "하퍼" | null
  timeMinutes: number | null
  manager: { membership_id: string; name: string } | null
  managerList: StaffItem[]
  participantId: string | null
  loading: boolean
  /**
   * True when the sheet opened with a parser-resolved store and skipped
   * the store-picker step automatically. When true, the manager step
   * renders a "back" control so the operator can correct a mis-inferred
   * store without closing the sheet.
   */
  isStoreAutoResolved: boolean
  /**
   * Parser-extracted ticket label (완티 / 반티 / 차3 / 반차3), when known.
   * Drives category-change-time-recalc: if the operator re-picks a
   * category in the sheet, timeMinutes is re-derived from
   * ticketToPreset(ticketType, newCategory) instead of the legacy
   * CATEGORIES[name].minutes (which only covers 완티 semantics). If not
   * set (card-tap path), legacy CATEGORIES lookup is used.
   */
  ticketType: string | null
}

export const SHEET_INIT: SheetState = {
  open: false, step: "store", store: "", storeUuid: null,
  category: null, timeMinutes: null, manager: null,
  managerList: [], participantId: null, loading: false,
  isStoreAutoResolved: false,
  ticketType: null,
}

export type MgrModalState = {
  open: boolean
  isExternal: boolean
  externalOrg: string
  externalName: string
  staffList: StaffItem[]
  selected: { membership_id: string; name: string } | null
}

export const MGR_MODAL_INIT: MgrModalState = {
  open: false, isExternal: false, externalOrg: "", externalName: "",
  staffList: [], selected: null,
}

export type OrderFormState = {
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  sale_price?: number
  inventory_item_id?: string | null
}

export const ORDER_FORM_INIT: OrderFormState = {
  item_name: "", order_type: "주류", qty: 1, unit_price: 0, sale_price: undefined, inventory_item_id: null,
}

/** 주문 종류 — bill 분류 기준과 일치 */
export const ORDER_TYPES = [
  { value: "주류",           label: "주류",     color: "text-amber-300" },
  { value: "웨이터팁",       label: "팁",       color: "text-purple-300" },
  { value: "room_fee_base",  label: "룸티",     color: "text-cyan-300" },
  { value: "room_fee_extra", label: "룸티연장", color: "text-teal-300" },
  { value: "사입",           label: "사입",     color: "text-slate-400" },
  { value: "기타",           label: "기타",     color: "text-slate-300" },
] as const

// ─── Constants ──────────────────────────────────────────────────────────────

// `STORES` 는 ParticipantSetupSheetV2 / 기타 picker UI에서 사용한다.
// 실제 store 목록/층/별칭의 단일 원본은 helpers/storeRegistry.ts 이며,
// 여기서는 picker가 기대하는 `{ name, floor: "N층" }` 포맷으로 재노출한다.
// 매장 추가·별칭 변경은 반드시 registry 파일만 건드려야 한다.
import { STORE_PICKER_LIST } from "./helpers/storeRegistry"
export const STORES: ReadonlyArray<{ name: string; floor: string }> = STORE_PICKER_LIST

// CATEGORIES는 helpers/categoryRegistry.ts 의 단일 원본에서 파생.
// 기존 import 경로 (`import { CATEGORIES } from "../types"`) 유지.
export { CATEGORIES } from "./helpers/categoryRegistry"
