/**
 * Visualize Phase 2 — single source of truth for graph colours.
 *
 * Both `components/visualize/NetworkGraph.tsx` (canvas drawing) and
 * `components/visualize/NetworkLegend.tsx` (UI legend) consume this
 * module so colour drift between graph and legend is impossible.
 *
 * Status colours are derived from severity classification — see
 * `lib/visualize/graph/categories.ts:classifyActionSeverity`.
 *
 * NOTE: this file is import-safe from both server and client paths
 * because it has no runtime dependencies beyond plain values.
 */

import type {
  NetworkEdgeType,
  NetworkNodeType,
  NetworkStatus,
} from "../shapes"

// ─── node types ──────────────────────────────────────────────────────

export const NODE_TYPE_COLOR: Record<NetworkNodeType, string> = {
  store: "#fbbf24",      // amber-400  — building anchor (sun)
  manager: "#a78bfa",    // violet-400
  hostess: "#22d3ee",    // cyan-400
  staff: "#34d399",      // emerald-400
  session: "#60a5fa",    // blue-400
  settlement: "#f472b6", // pink-400
  payout: "#86efac",     // green-300
  audit: "#94a3b8",      // slate-400
}

export const NODE_TYPE_LABEL: Record<NetworkNodeType, string> = {
  store: "매장",
  manager: "실장",
  hostess: "아가씨",
  staff: "스태프",
  session: "세션",
  settlement: "정산",
  payout: "지급",
  audit: "감사",
}

// ─── status (severity) tones ─────────────────────────────────────────

export const STATUS_COLOR: Record<NetworkStatus, string> = {
  normal: "#10b981",  // emerald
  warning: "#f59e0b", // amber
  risk: "#ef4444",    // red
}

/** Severity overlay applied on top of the node's base type colour. */
export const STATUS_OVERLAY_COLOR: Record<NetworkStatus, string | null> = {
  normal: null,
  warning: "#f59e0b",
  risk: "#ef4444",
}

export const STATUS_LABEL: Record<NetworkStatus, string> = {
  normal: "정상",
  warning: "경고 (force/override/edit)",
  risk: "위험 (reject/reverse/cancel)",
}

// ─── edge types ──────────────────────────────────────────────────────

export type EdgeStyle = {
  color: string
  /** Whether to render with a dashed line. */
  dashed?: boolean
  /** Whether to render with a directional arrow head. */
  arrow?: boolean
}

export const EDGE_TYPE_STYLE: Record<NetworkEdgeType, EdgeStyle> = {
  belongs_to: { color: "rgba(148,163,184,0.30)" },
  managed_by: { color: "rgba(34,211,238,0.45)" },
  produced: { color: "rgba(96,165,250,0.45)", arrow: true },
  paid_to: { color: "rgba(134,239,172,0.50)", arrow: true },
  participated_in: { color: "rgba(167,139,250,0.30)" },
  worked_at: { color: "rgba(34,211,238,0.55)", dashed: true, arrow: true },
  owes_to: { color: "rgba(245,158,11,0.65)", dashed: true, arrow: true },
  transferred: { color: "rgba(96,165,250,0.55)", dashed: true, arrow: true },
  approved_by: { color: "rgba(134,239,172,0.50)" },
  edited_by: { color: "rgba(245,158,11,0.55)" },
  rejected: { color: "rgba(239,68,68,0.65)" },
  reversed: { color: "rgba(239,68,68,0.65)" },
  cancelled_partial: { color: "rgba(239,68,68,0.65)" },
}

export const EDGE_TYPE_LABEL: Record<NetworkEdgeType, string> = {
  belongs_to: "소속",
  managed_by: "담당 실장",
  produced: "정산 생성",
  paid_to: "지급",
  participated_in: "세션 참여",
  worked_at: "타매장 근무",
  owes_to: "타매장 채무",
  transferred: "이적",
  approved_by: "승인",
  edited_by: "수정",
  rejected: "거부",
  reversed: "반환",
  cancelled_partial: "부분 취소",
}

// ─── runtime helpers ────────────────────────────────────────────────

export function nodeBaseColor(type: NetworkNodeType): string {
  return NODE_TYPE_COLOR[type] ?? "#64748b"
}

export function nodeOverlayColor(status: NetworkStatus | undefined): string | null {
  if (!status) return null
  return STATUS_OVERLAY_COLOR[status]
}

export function edgeStyle(type: NetworkEdgeType | string): EdgeStyle {
  return (
    EDGE_TYPE_STYLE[type as NetworkEdgeType] ?? {
      color: "rgba(148,163,184,0.35)",
    }
  )
}

/**
 * Status-driven edge colour. Used when an edge inherits its severity
 * from a flagged audit/payout state; falls back to the type's base
 * colour otherwise.
 */
export function edgeStatusColor(
  status: NetworkStatus | undefined,
  type: NetworkEdgeType | string,
): string {
  if (status === "risk") return "rgba(239,68,68,0.80)"
  if (status === "warning") return "rgba(245,158,11,0.65)"
  return edgeStyle(type).color
}

/** Edge dash pattern; null when solid. */
export function edgeDash(
  status: NetworkStatus | undefined,
  type: NetworkEdgeType | string,
): [number, number] | null {
  if (status === "risk") return [4, 3]
  const style = edgeStyle(type)
  return style.dashed ? [4, 3] : null
}
