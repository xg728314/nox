/**
 * /super-admin/stores/[store_uuid] — types + helpers.
 *
 * 2026-05-03: page.tsx 분할.
 */

export type Tab = "ops" | "owner" | "manager"

export type SessionInfo = {
  id: string
  status: string
  started_at: string
  ended_at: string | null
  participant_count: number
  gross_total: number
  participant_total: number
  order_total: number
  manager_name: string | null
  customer_name_snapshot: string | null
  customer_party_size: number
}

export type RoomInfo = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session: SessionInfo | null
  closed_session: SessionInfo | null
}

export type MonitorData = {
  store: { id: string; store_name: string; store_code: string | null; floor: number | null; is_active: boolean }
  business_day: { id: string; business_date: string; status: string; opened_at: string | null; closed_at: string | null } | null
  rooms: RoomInfo[]
  kpis_today: {
    total_sessions: number
    gross_total: number
    finalized_count: number
    draft_count: number
    unsettled_count: number
  }
}

export type OwnerSettlementData = {
  store_uuid: string
  business_day_id: string | null
  business_date: string | null
  business_day_status: string | null
  summary: {
    total_sessions: number
    tc_count: number
    liquor_sales: number
    owner_revenue: number
    waiter_tips: number
    purchases: number
    gross_total: number
    owner_margin: number
    finalized_count: number
    draft_count: number
    unsettled_count: number
  } | null
  sessions: {
    session_id: string
    room_name: string | null
    session_status: string
    tc_count: number
    liquor_sales: number
    waiter_tips: number
    purchases: number
    gross_total: number | null
    owner_margin: number | null
    receipt_status: string | null
  }[]
}

export type ManagerSettlementData = {
  store_uuid: string
  business_day_id: string | null
  managers: {
    manager_membership_id: string
    manager_name: string
    hostess_count: number
    settlement_sessions: number
    total_gross: number
    total_manager_amount: number
    total_hostess_amount: number
    finalized_count: number
    draft_count: number
  }[]
}

export type ForceCloseTarget = {
  session_id: string
  room_name: string
  started_at: string
  manager_name: string | null
  gross_total: number
  participant_count: number
} | null

export type RecoverTarget = {
  session_id: string
  room_name: string
} | null

// ─── Helpers ────────────────────────────────────────────────────────

export function fmtWon(n: number | null | undefined): string {
  const v = typeof n === "number" ? n : 0
  if (v === 0) return "0원"
  if (v >= 10_000) return `${Math.floor(v / 10_000).toLocaleString()}만 ${(v % 10_000).toLocaleString()}원`.replace(" 0원", "")
  return `${v.toLocaleString()}원`
}
