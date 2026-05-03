/**
 * 정산 트리 — 공유 types + helpers.
 *
 * 2026-05-03: app/payouts/settlement-tree/page.tsx 분할.
 */

export type StoreEntry = {
  counterpart_store_uuid: string
  counterpart_store_name: string
  outbound_total: number
  outbound_paid?: number
  outbound_remaining?: number
  inbound_total: number
  inbound_paid?: number
  inbound_remaining?: number
  net_amount: number
  outbound_count?: number
  inbound_count?: number
  outbound_prepaid?: number
}

export type ManagerEntry = {
  manager_membership_id: string
  manager_name: string
  outbound_amount: number
  outbound_paid?: number
  outbound_count?: number
  inbound_amount: number
  inbound_paid?: number
  inbound_count?: number
  net_amount: number
  outbound_prepaid?: number
  outbound_remaining?: number
}

export type HostessEntry = {
  participant_id: string
  session_id: string
  direction: "outbound" | "inbound"
  membership_id: string
  hostess_name: string | null
  room_name: string | null
  category: string | null
  time_minutes: number
  price_amount: number
  hostess_payout: number
  status: string
  entered_at: string
  left_at: string | null
}

export type DataBasis = "operational" | "formal"
export type Direction = "all" | "inbound" | "outbound"

export const won = (v: number | null | undefined) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0
  return n.toLocaleString("ko-KR") + "원"
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
