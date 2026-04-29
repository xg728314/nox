"use client"

/**
 * NetworkLegend — collapsible visual legend for the Jarvis network map.
 *
 * Reads the colour/style palette from `lib/visualize/graph/legendConfig.ts`
 * (single source) so it can never drift from `NetworkGraph.tsx`.
 */

import { useState } from "react"
import {
  EDGE_TYPE_LABEL,
  EDGE_TYPE_STYLE,
  NODE_TYPE_COLOR,
  NODE_TYPE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from "@/lib/visualize/graph/legendConfig"
import type {
  NetworkEdgeType,
  NetworkNodeType,
  NetworkStatus,
} from "@/lib/visualize/shapes"

const NODE_TYPE_ORDER: ReadonlyArray<NetworkNodeType> = [
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
  "payout",
  "audit",
]

// Pick the most "structural" 10 edges for the legend; the rest (e.g.
// `rejected` / `reversed` / `cancelled_partial`) are still rendered in
// the graph but their meaning is conveyed via the status (red) tone
// row below.
const EDGE_TYPE_ORDER: ReadonlyArray<NetworkEdgeType> = [
  "belongs_to",
  "managed_by",
  "produced",
  "paid_to",
  "participated_in",
  "worked_at",
  "owes_to",
  "transferred",
  "approved_by",
  "edited_by",
]

const STATUS_ORDER: ReadonlyArray<NetworkStatus> = ["normal", "warning", "risk"]

export default function NetworkLegend() {
  const [open, setOpen] = useState<boolean>(false)

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
        aria-expanded={open}
        aria-controls="visualize-legend-panel"
      >
        범례 {open ? "▾" : "▸"}
      </button>

      {open && (
        <div
          id="visualize-legend-panel"
          className="mt-1 rounded border border-slate-700 bg-slate-900/90 backdrop-blur p-2 text-[10px] text-slate-300 w-56"
        >
          <div className="mb-2">
            <div className="text-slate-500 uppercase tracking-wide mb-1">노드</div>
            <div className="grid grid-cols-2 gap-1">
              {NODE_TYPE_ORDER.map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: NODE_TYPE_COLOR[t] }}
                  />
                  <span className="truncate">{NODE_TYPE_LABEL[t]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-2">
            <div className="text-slate-500 uppercase tracking-wide mb-1">엣지</div>
            <ul className="space-y-0.5">
              {EDGE_TYPE_ORDER.map((t) => {
                const style = EDGE_TYPE_STYLE[t]
                return (
                  <li key={t} className="flex items-center gap-1.5">
                    <svg width="22" height="6" aria-hidden>
                      <line
                        x1="0"
                        y1="3"
                        x2={style.arrow ? 18 : 22}
                        y2="3"
                        stroke={style.color}
                        strokeWidth="2"
                        strokeDasharray={style.dashed ? "4 3" : undefined}
                      />
                      {style.arrow && (
                        <polygon points="18,0 22,3 18,6" fill={style.color} />
                      )}
                    </svg>
                    <span className="truncate">{EDGE_TYPE_LABEL[t]}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          <div>
            <div className="text-slate-500 uppercase tracking-wide mb-1">상태</div>
            <ul className="space-y-0.5">
              {STATUS_ORDER.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: STATUS_COLOR[s] }}
                  />
                  <span>{STATUS_LABEL[s]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
