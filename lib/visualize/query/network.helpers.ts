/**
 * Visualize Phase 2 — network graph helpers.
 *
 * 2026-05-03: lib/visualize/query/network.ts 분할.
 *   id 생성, role 매핑, 표 라벨, 숫자 포매팅 등 stateless helpers.
 */

import { maskName } from "../pii"
import type {
  NetworkEdgeType,
  NetworkNodeType,
} from "../shapes"
import type { HostessRow, ManagerRow, ProfileRow } from "./network.types"

export const MEMBERSHIP_ROLES_OF_INTEREST: ReadonlyArray<{
  role: string
  nodeType: NetworkNodeType
}> = [
  { role: "manager", nodeType: "manager" },
  { role: "hostess", nodeType: "hostess" },
  { role: "waiter", nodeType: "staff" },
  { role: "staff", nodeType: "staff" },
]

// Risky payout signals — DB constraints (post-038).
export const PAYOUT_RISK_STATUSES = new Set(["cancelled"])
export const PAYOUT_RISK_TYPES = new Set(["reversal"])
export const SETTLEMENT_WARNING_STATUSES = new Set(["draft", "open", "partial"])
export const CROSS_STORE_CLOSED_STATUSES = new Set(["closed", "settled"])

export function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  if (v >= 1) return 1
  return v
}

// ─── id helpers ────────────────────────────────────────────────────────

export function storeNodeId(uuid: string): string {
  return `store:${uuid}`
}

export function personNodeId(type: NetworkNodeType, membershipId: string): string {
  return `${type}:${membershipId}`
}

export function sessionNodeId(uuid: string): string {
  return `session:${uuid}`
}

export function settlementNodeId(uuid: string): string {
  return `settlement:${uuid}`
}

export function edgeId(type: NetworkEdgeType, key: string): string {
  return `${type}:${key}`
}

export function mapRoleToNodeType(role: string): NetworkNodeType | null {
  const hit = MEMBERSHIP_ROLES_OF_INTEREST.find((r) => r.role === role)
  return hit?.nodeType ?? null
}

// Compact KRW formatter for node labels (graph context — short string).
export function formatWonShort(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}천만`
  if (abs >= 10_000) return `${sign}${Math.floor(abs / 10_000).toLocaleString()}만`
  return `${sign}${Math.round(abs).toLocaleString()}`
}

// ─── label helpers (PII default = mask; super_admin unmask = real) ───

export function resolveHostessLabel(
  h: HostessRow | null,
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  // stage_name (예명) is non-PII performer alias — surface even when masked.
  const stage = h?.stage_name?.trim() || null
  if (unmasked) {
    return stage ?? h?.name ?? profile?.full_name ?? "(아가씨)"
  }
  if (stage) return stage
  return maskName(h?.name ?? profile?.nickname ?? profile?.full_name ?? "")
    || "(아가씨)"
}

export function resolveManagerLabel(
  m: ManagerRow | null,
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  const nick = m?.nickname?.trim() || profile?.nickname?.trim() || null
  if (unmasked) {
    return nick ?? m?.name ?? profile?.full_name ?? "(실장)"
  }
  // nickname is operator-chosen handle; treat as non-PII label.
  if (nick) return nick
  return maskName(m?.name ?? profile?.full_name ?? "") || "(실장)"
}

export function resolveStaffLabel(
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  const nick = profile?.nickname?.trim() || null
  if (unmasked) {
    return nick ?? profile?.full_name ?? "(스태프)"
  }
  if (nick) return nick
  return maskName(profile?.full_name ?? "") || "(스태프)"
}
