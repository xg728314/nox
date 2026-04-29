"use client"

/**
 * OperationsSidebar — operational triage view alongside the graph.
 *
 * Two stacked sections, both computed purely from the in-memory
 * `NetworkGraphResponse` (no extra fetch, no recalculation):
 *
 *   1. 오늘 신호 — anomaly counts (payout risk / cross-store pending /
 *      unsettled / risky audit). Each row is clickable: clicking jumps
 *      selection to a representative node.
 *   2. 매장 활동 — per-store metrics (sessions, settlement total, last
 *      activity timestamp, risk badge). Click a row → store node
 *      selection + auto-focus.
 *
 * Empty stores are SHOWN here even when hidden in the graph — that's
 * the sidebar's purpose: tell the operator what they're NOT looking at.
 */

import { useMemo } from "react"
import type {
  NetworkGraphResponse,
  NetworkNode,
} from "@/lib/visualize/shapes"

type Props = {
  data: NetworkGraphResponse | null
  onSelectNode: (node: NetworkNode) => void
}

type AnomalySignal = {
  kind: "payout_risk" | "cross_store_pending" | "settlement_warning" | "audit_risk"
  label: string
  count: number
  sumAmount: number
  representative?: NetworkNode
  detailLabel?: string
}

type StoreActivity = {
  store_uuid: string
  store_node: NetworkNode
  store_label: string
  floor: number | null
  session_count: number
  settlement_count: number
  settlement_total: number
  payout_risk_count: number
  audit_risk_count: number
  last_activity_at: string | null
  has_owes_to_pending: boolean
}

function fmtWon(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0"
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`
  if (Math.abs(n) >= 10_000) return `${Math.floor(n / 10_000).toLocaleString()}만`
  return `${Math.round(n).toLocaleString()}`
}

function timeSince(iso: string | null): string {
  if (!iso) return "—"
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return "—"
  const diffSec = Math.max(0, (Date.now() - dt.getTime()) / 1000)
  if (diffSec < 60) return `${Math.floor(diffSec)}초 전`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`
  return `${Math.floor(diffSec / 86400)}일 전`
}

function computeSignals(data: NetworkGraphResponse): AnomalySignal[] {
  const signals: AnomalySignal[] = []

  // 1. payout risk — payout nodes with status='risk'
  let payoutRiskCount = 0
  let payoutRiskSum = 0
  let payoutRep: NetworkNode | undefined
  for (const n of data.nodes) {
    if (n.type === "payout" && n.status === "risk") {
      payoutRiskCount += 1
      payoutRiskSum += (n.meta?.amount as number) ?? 0
      if (!payoutRep) payoutRep = n
    }
  }
  signals.push({
    kind: "payout_risk",
    label: "지급 반환·취소",
    count: payoutRiskCount,
    sumAmount: payoutRiskSum,
    representative: payoutRep,
    detailLabel: payoutRep?.label,
  })

  // 2. cross-store pending — owes_to edges with status='warning'
  let owesCount = 0
  let owesSum = 0
  let owesRep: NetworkNode | undefined
  const nodeById = new Map<string, NetworkNode>()
  for (const n of data.nodes) nodeById.set(n.id, n)
  for (const e of data.edges) {
    if (e.type !== "owes_to") continue
    if (e.status === "warning" || e.status === "risk") {
      owesCount += 1
      owesSum += e.amount ?? 0
      if (!owesRep) owesRep = nodeById.get(e.source)
    }
  }
  signals.push({
    kind: "cross_store_pending",
    label: "타매장 미수금",
    count: owesCount,
    sumAmount: owesSum,
    representative: owesRep,
    detailLabel: owesRep?.label,
  })

  // 3. settlement warning — settlement nodes with status='warning' (draft/open)
  let unsettledCount = 0
  let unsettledSum = 0
  let unsettledRep: NetworkNode | undefined
  for (const n of data.nodes) {
    if (n.type === "settlement" && n.status === "warning") {
      unsettledCount += 1
      unsettledSum += (n.meta?.total_amount as number) ?? 0
      if (!unsettledRep) unsettledRep = n
    }
  }
  signals.push({
    kind: "settlement_warning",
    label: "미마감 정산",
    count: unsettledCount,
    sumAmount: unsettledSum,
    representative: unsettledRep,
    detailLabel: unsettledRep?.label,
  })

  // 4. audit risk — audit nodes with status='risk'
  let auditRiskCount = 0
  let auditRep: NetworkNode | undefined
  for (const n of data.nodes) {
    if (n.type === "audit" && n.status === "risk") {
      auditRiskCount += 1
      if (!auditRep) auditRep = n
    }
  }
  signals.push({
    kind: "audit_risk",
    label: "위험 감사 이벤트",
    count: auditRiskCount,
    sumAmount: 0,
    representative: auditRep,
    detailLabel: auditRep?.label,
  })

  return signals
}

function computeStoreActivities(data: NetworkGraphResponse): StoreActivity[] {
  const stores = data.nodes.filter((n) => n.type === "store")
  const result: StoreActivity[] = []

  for (const store of stores) {
    const storeUuid = store.store_uuid
    if (!storeUuid) continue
    let session_count = 0
    let settlement_count = 0
    let settlement_total = 0
    let payout_risk_count = 0
    let audit_risk_count = 0
    let last_activity_at: string | null = null

    for (const n of data.nodes) {
      if (n.store_uuid !== storeUuid) continue
      if (n.type === "session") {
        session_count += 1
        const startedAt = n.meta?.started_at as string | undefined
        if (startedAt && (!last_activity_at || startedAt > last_activity_at)) {
          last_activity_at = startedAt
        }
      } else if (n.type === "settlement") {
        settlement_count += 1
        settlement_total += (n.meta?.total_amount as number) ?? 0
        const at = (n.meta?.confirmed_at as string | undefined) ?? null
        if (at && (!last_activity_at || at > last_activity_at)) {
          last_activity_at = at
        }
      } else if (n.type === "payout" && n.status === "risk") {
        payout_risk_count += 1
      } else if (n.type === "audit") {
        if (n.status === "risk") audit_risk_count += 1
        const at = n.meta?.last_at as string | undefined
        if (at && (!last_activity_at || at > last_activity_at)) {
          last_activity_at = at
        }
      }
    }

    let has_owes_to_pending = false
    for (const e of data.edges) {
      if (e.type !== "owes_to") continue
      if ((e.source === store.id || e.target === store.id) && (e.status === "warning" || e.status === "risk")) {
        has_owes_to_pending = true
        break
      }
    }

    result.push({
      store_uuid: storeUuid,
      store_node: store,
      store_label: store.label,
      floor: typeof store.meta?.floor === "number" ? (store.meta.floor as number) : null,
      session_count,
      settlement_count,
      settlement_total,
      payout_risk_count,
      audit_risk_count,
      last_activity_at,
      has_owes_to_pending,
    })
  }
  // Sort: stores with risk first, then by activity, then label.
  result.sort((a, b) => {
    const ra = a.payout_risk_count + a.audit_risk_count + (a.has_owes_to_pending ? 1 : 0)
    const rb = b.payout_risk_count + b.audit_risk_count + (b.has_owes_to_pending ? 1 : 0)
    if (rb !== ra) return rb - ra
    const aa = a.session_count + a.settlement_count
    const ab = b.session_count + b.settlement_count
    if (ab !== aa) return ab - aa
    return a.store_label.localeCompare(b.store_label, "ko")
  })
  return result
}

export default function OperationsSidebar({ data, onSelectNode }: Props) {
  const signals = useMemo(() => (data ? computeSignals(data) : []), [data])
  const stores = useMemo(() => (data ? computeStoreActivities(data) : []), [data])

  const totalSignalCount = signals.reduce((a, s) => a + s.count, 0)
  const activeStoreCount = stores.filter((s) => s.session_count + s.settlement_count > 0).length

  return (
    <aside className="w-full md:w-64 shrink-0 space-y-3">
      {/* ─── Anomaly summary ─── */}
      <section className="rounded border border-slate-700 bg-slate-900">
        <header className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">오늘 신호</div>
            <div
              className={`text-sm font-semibold ${
                totalSignalCount > 0 ? "text-amber-300" : "text-slate-200"
              }`}
            >
              {totalSignalCount === 0 ? "이상 없음" : `${totalSignalCount}건 감지`}
            </div>
          </div>
          {totalSignalCount > 0 && <span className="text-amber-400 text-lg">⚠</span>}
        </header>
        <ul className="divide-y divide-slate-800">
          {signals.map((s) => {
            const navigable = !!s.representative
            const Tag = navigable ? "button" : "div"
            const isActive = s.count > 0
            return (
              <li key={s.kind}>
                <Tag
                  type={navigable ? "button" : undefined}
                  onClick={
                    navigable
                      ? () => s.representative && onSelectNode(s.representative)
                      : undefined
                  }
                  className={[
                    "w-full text-left px-3 py-2 flex items-center gap-2",
                    navigable ? "hover:bg-slate-800 cursor-pointer" : "",
                    isActive ? "" : "opacity-60",
                  ].join(" ")}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      isActive ? "bg-amber-400" : "bg-slate-600"
                    }`}
                  />
                  <span className="flex-1 text-[11px] text-slate-300 truncate">{s.label}</span>
                  <span
                    className={`text-[11px] tabular-nums ${
                      isActive ? "text-amber-300" : "text-slate-500"
                    }`}
                  >
                    {s.count}
                    {s.sumAmount > 0 && (
                      <span className="text-slate-500 ml-1">·{fmtWon(s.sumAmount)}</span>
                    )}
                  </span>
                </Tag>
                {s.detailLabel && s.count > 0 && (
                  <div className="text-[10px] text-slate-500 px-3 pb-1.5 -mt-1 truncate">
                    → {s.detailLabel}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* ─── Store activity rail ─── */}
      <section className="rounded border border-slate-700 bg-slate-900">
        <header className="p-3 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">매장 활동</div>
          <div className="text-sm text-slate-200">
            <span className="text-slate-100 font-semibold">{activeStoreCount}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span className="text-slate-400">{stores.length} 매장</span>
            <span className="text-slate-500 ml-1">활동</span>
          </div>
        </header>
        <ul className="divide-y divide-slate-800 max-h-[420px] overflow-y-auto">
          {stores.map((s) => {
            const hasRisk = s.payout_risk_count + s.audit_risk_count > 0 || s.has_owes_to_pending
            const isActive = s.session_count + s.settlement_count > 0
            return (
              <li key={s.store_uuid}>
                <button
                  type="button"
                  onClick={() => onSelectNode(s.store_node)}
                  className={[
                    "w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors flex items-start gap-2",
                    isActive ? "" : "opacity-50",
                  ].join(" ")}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 ${
                      hasRisk
                        ? "bg-red-400"
                        : isActive
                        ? "bg-emerald-400"
                        : "bg-slate-600"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-200 truncate">{s.store_label}</span>
                      {s.floor != null && (
                        <span className="text-[9px] text-slate-500 shrink-0">{s.floor}F</span>
                      )}
                      {hasRisk && (
                        <span className="text-[9px] text-red-300 shrink-0">⚠</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0">
                      {isActive ? (
                        <>
                          {s.session_count > 0 && <span>세션 {s.session_count}</span>}
                          {s.settlement_count > 0 && (
                            <span>정산 {s.settlement_count} ({fmtWon(s.settlement_total)})</span>
                          )}
                          {s.last_activity_at && (
                            <span className="text-slate-600">{timeSince(s.last_activity_at)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600">활동 없음</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
