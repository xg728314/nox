"use client"

/**
 * MoneyFlowSankey — adapter from MoneyFlowResponse → Sankey props.
 *
 * Wraps the generic <Sankey/> with money-flow-specific defaults (colors,
 * Korean number format) and a simple legend.
 */

import { ParentSize } from "@visx/responsive"
import Sankey, { type SankeyLinkInput, type SankeyNodeInput } from "./Sankey"
import type { MoneyFlowResponse, MoneyLink, MoneyNode } from "@/lib/visualize/shapes"

type Props = {
  data: MoneyFlowResponse
  /** Render height. Width is responsive. Default 520. */
  height?: number
}

function fmtWon(n: number): string {
  if (!Number.isFinite(n)) return "0원"
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}천만`
  if (n >= 10_000) return `${Math.floor(n / 10_000).toLocaleString()}만`
  return `${Math.round(n).toLocaleString()}원`
}

const KIND_LABEL: Record<string, string> = {
  primary: "정상 흐름",
  deduction: "선정산 차감",
  cross_store: "타매장 송금",
  reversal: "거부/반환",
  outstanding: "외상",
}

const NODE_GROUP_LABEL: Record<string, string> = {
  source: "매출 원천",
  aggregate: "집계 (영수증)",
  allocation: "분배",
  sink: "유출",
  reversal: "차감",
}

export default function MoneyFlowSankey({ data, height = 520 }: Props) {
  const nodes: SankeyNodeInput[] = (data.nodes as MoneyNode[]).map((n) => ({
    id: n.id,
    label: n.label,
    group: n.group,
    amount: n.amount,
    derived: n.derived,
  }))
  const links: SankeyLinkInput[] = (data.links as MoneyLink[]).map((l) => ({
    source: l.source,
    target: l.target,
    amount: l.amount,
    kind: l.kind,
  }))

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-700 bg-slate-900 p-3">
        <ParentSize>
          {({ width }) => (
            <Sankey
              nodes={nodes}
              links={links}
              width={Math.max(320, width)}
              height={height}
              format={fmtWon}
            />
          )}
        </ParentSize>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">노드:</span>
          {Object.entries(NODE_GROUP_LABEL).map(([g, label]) => (
            <span key={g} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: groupColor(g) }}
              />
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">흐름:</span>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <svg width="18" height="6" aria-hidden>
                <line
                  x1="0" y1="3" x2="18" y2="3"
                  stroke={kindColor(k)} strokeWidth="2"
                  strokeDasharray={kindDash(k)}
                />
              </svg>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function groupColor(g: string): string {
  return (
    {
      source: "#0ea5e9",
      aggregate: "#6366f1",
      allocation: "#a855f7",
      sink: "#10b981",
      reversal: "#ef4444",
    } as Record<string, string>
  )[g] ?? "#64748b"
}

function kindColor(k: string): string {
  return (
    {
      primary: "#64748b",
      deduction: "#f59e0b",
      cross_store: "#06b6d4",
      reversal: "#ef4444",
      outstanding: "#a855f7",
    } as Record<string, string>
  )[k] ?? "#475569"
}

function kindDash(k: string): string | undefined {
  return ({ reversal: "4 3", deduction: "2 2" } as Record<string, string>)[k]
}
