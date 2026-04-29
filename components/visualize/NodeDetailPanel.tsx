"use client"

/**
 * NodeDetailPanel — right-side slide-out for a clicked node.
 *
 * Shows label + type badge + status + counted neighbours + meta fields.
 * Phase 2.1g: lazy-fetches `/api/super-admin/visualize/graph/node/{type}/{id}`
 * for the 6 supported drill-down types (store/manager/hostess/staff/
 * session/settlement) and renders an "원본 데이터" subsection. Aggregate
 * node types (payout/audit) skip the detail fetch and rely on in-memory
 * meta only.
 *
 * Failures degrade silently — the in-memory meta still renders so the
 * panel never goes blank.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { NetworkEdge, NetworkNode } from "@/lib/visualize/shapes"
import { isSensitiveColumn } from "@/lib/visualize/denylist"

type NodeDetailResponse = {
  as_of: string
  type: string
  id: string
  store_uuid: string | null
  label: string
  primary: Record<string, unknown>
  relations: Record<string, unknown>
  source_tables: string[]
  warnings: string[]
}

const DRILL_SUPPORTED: ReadonlySet<string> = new Set([
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
  "payout",
  "audit",
])

// UUID-typed nodes — id after the `<type>:` prefix is a clean UUID.
const UUID_DRILL_TYPES: ReadonlySet<string> = new Set([
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
])

type Props = {
  node: NetworkNode | null
  edges: NetworkEdge[]
  /** Lookup by node id → label for "connected to" listing. */
  nodeLabelMap: Map<string, { label: string; type: string }>
  /** P2.1l: full node lookup so the panel can navigate to a peer when
   *  the user clicks one of the listed connected nodes. */
  nodeById?: Map<string, NetworkNode>
  /** P2.1l: callback fired when the user clicks a peer in the
   *  "연결된 관계" list — parent should call setSelectedNode(peer). */
  onSelectNode?: (node: NetworkNode) => void
  /** P2.1i: when true, drill-down request appends `?unmask=true`. The
   *  server enforces super_admin and records `unmasked:true` in audit. */
  unmask?: boolean
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  store: "매장",
  manager: "실장",
  hostess: "아가씨",
  staff: "스태프",
  session: "세션",
  settlement: "정산",
  payout: "지급",
  audit: "감사",
}

const STATUS_TONE: Record<string, string> = {
  normal: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  risk: "bg-rose-500/15 text-rose-300",
}

const EDGE_LABEL: Record<string, string> = {
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

function fmtWon(n: number): string {
  if (!Number.isFinite(n)) return "0원"
  if (n === 0) return "0원"
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`
  if (Math.abs(n) >= 10_000) return `${Math.floor(n / 10_000).toLocaleString()}만`
  return `${Math.round(n).toLocaleString()}원`
}

function isMoneyKey(key: string): boolean {
  return /amount|total|prepaid|remaining|gross|payout|margin/i.test(key)
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function RawJsonSection({
  node,
  detail,
}: {
  node: NetworkNode
  detail: NodeDetailResponse | null
}) {
  const [open, setOpen] = useState<boolean>(false)
  if (!open) {
    return (
      <section className="p-3 border-b border-slate-800">
        <button
          onClick={() => setOpen(true)}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          ▸ raw JSON (개발자 모드)
        </button>
      </section>
    )
  }
  // Strip sensitive keys defensively before rendering.
  const safeNode: unknown = scrubSensitive(node as unknown as Record<string, unknown>)
  const safeDetail: unknown = detail ? scrubSensitive(detail as unknown as Record<string, unknown>) : null
  const hasDetail = safeDetail != null
  return (
    <section className="p-3 border-b border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          raw JSON
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          ▾ 접기
        </button>
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">node</div>
          <pre className="text-[10px] text-slate-300 bg-slate-950 border border-slate-800 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(safeNode, null, 2)}
          </pre>
        </div>
        {hasDetail ? (
          <div>
            <div className="text-[10px] text-slate-500 mb-0.5">detail</div>
            <pre className="text-[10px] text-slate-300 bg-slate-950 border border-slate-800 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(safeDetail, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Recursive scrub — replaces sensitive-keyed values with "***" before
 * we serialize for the dev-mode JSON view. Keeps array/object shape so
 * the structure is still legible.
 */
function scrubSensitive(input: unknown): unknown {
  if (input == null) return input
  if (Array.isArray(input)) return input.map((v) => scrubSensitive(v))
  if (typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveColumn(k)) {
        out[k] = "***"
      } else {
        out[k] = scrubSensitive(v)
      }
    }
    return out
  }
  return input
}

function shortId(v: string): string {
  if (!isUuid(v)) return v
  return `${v.slice(0, 8)}…${v.slice(-4)}`
}

function formatMetaValue(key: string, value: unknown): string {
  if (value == null) return "—"
  if (typeof value === "number") {
    if (isMoneyKey(key)) return fmtWon(value)
    return value.toLocaleString()
  }
  if (typeof value === "string") {
    if (isUuid(value)) return shortId(value)
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      // ISO timestamp — show time-of-day for readability
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString("ko-KR", { hour12: false })
      }
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    if (value.length <= 3) return value.map((v) => formatMetaValue(key, v)).join(", ")
    return `${value.length}건`
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

export default function NodeDetailPanel({ node, edges, nodeLabelMap, nodeById, onSelectNode, unmask, onClose }: Props) {
  // ── Lazy drill-down fetch ────────────────────────────────────────────
  const [detail, setDetail] = useState<NodeDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState<boolean>(false)
  const [detailError, setDetailError] = useState<string>("")

  useEffect(() => {
    if (!node) {
      setDetail(null)
      setDetailError("")
      return
    }
    if (!DRILL_SUPPORTED.has(node.type)) {
      setDetail(null)
      setDetailError("")
      return
    }
    // Extract id after the leading "<type>:" prefix. UUID-typed nodes
    // require a 36-char UUID; aggregate nodes (payout/audit) accept any
    // non-empty composite key (server validates the shape).
    const firstColon = node.id.indexOf(":")
    const entityId = firstColon >= 0 ? node.id.slice(firstColon + 1) : null
    if (!entityId) {
      setDetail(null)
      setDetailError("")
      return
    }
    if (UUID_DRILL_TYPES.has(node.type) && !/^[0-9a-f-]{36}$/i.test(entityId)) {
      setDetail(null)
      setDetailError("")
      return
    }

    let cancelled = false
    setDetailLoading(true)
    setDetailError("")
    ;(async () => {
      try {
        // encodeURIComponent so composite keys (payout/audit) survive
        // the URL parser. UUIDs are unaffected.
        const qs = unmask ? "?unmask=true" : ""
        const url = `/api/super-admin/visualize/graph/node/${node.type}/${encodeURIComponent(entityId)}${qs}`
        const res = await apiFetch(url, { cache: "no-store" })
        if (cancelled) return
        if (!res.ok) {
          setDetail(null)
          setDetailError(`상세 조회 실패 (${res.status})`)
          return
        }
        const body = (await res.json()) as NodeDetailResponse
        if (cancelled) return
        setDetail(body)
      } catch {
        if (!cancelled) setDetailError("상세 조회 실패")
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [node, unmask])

  if (!node) return null

  const incoming: NetworkEdge[] = []
  const outgoing: NetworkEdge[] = []
  for (const e of edges) {
    if (e.target === node.id) incoming.push(e)
    if (e.source === node.id) outgoing.push(e)
  }

  // Aggregate neighbours by edge type+direction for compact summary.
  // Each group holds up to PEER_PILL_LIMIT clickable peer pills; the rest
  // collapse into "+N".
  const PEER_PILL_LIMIT = 6
  type Group = {
    count: number
    peers: Array<{ id: string; label: string; type: string }>
    overflow: number
  }
  const byType = new Map<string, Group>()
  for (const e of [...outgoing, ...incoming]) {
    const peerId = e.source === node.id ? e.target : e.source
    const peer = nodeLabelMap.get(peerId)
    const typeKey = `${e.type}|${e.source === node.id ? "out" : "in"}`
    const cur = byType.get(typeKey) ?? { count: 0, peers: [], overflow: 0 }
    cur.count += 1
    if (peer && cur.peers.length < PEER_PILL_LIMIT) {
      // Dedupe by peer id so worked_at aggregations don't repeat the
      // same store across multiple sessions.
      if (!cur.peers.some((p) => p.id === peerId)) {
        cur.peers.push({ id: peerId, label: peer.label, type: peer.type })
      }
    } else if (peer && cur.peers.length === PEER_PILL_LIMIT) {
      // Edge surfaces beyond the pill limit fold into overflow.
      if (!cur.peers.some((p) => p.id === peerId)) cur.overflow += 1
    }
    byType.set(typeKey, cur)
  }

  const statusTone =
    (node.status && STATUS_TONE[node.status]) ?? STATUS_TONE.normal

  // Meta filter — drop sensitive keys; values are simple primitives only
  // (objects/arrays already protected by the response shape, but be safe).
  const metaEntries: Array<[string, unknown]> = node.meta
    ? Object.entries(node.meta).filter(([k]) => !isSensitiveColumn(k))
    : []

  return (
    <aside
      className="rounded border border-slate-700 bg-slate-900 text-slate-200 w-full md:w-80 max-h-[calc(100vh-160px)] overflow-y-auto"
      aria-label="노드 상세"
    >
      <header className="flex items-start justify-between gap-2 p-3 border-b border-slate-800 sticky top-0 bg-slate-900">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {TYPE_LABEL[node.type] ?? node.type}
            </span>
            {node.status && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusTone}`}>
                {node.status}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-100 truncate">
            {node.label}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 break-all">{shortId(node.id)}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="text-slate-400 hover:text-slate-100 text-sm shrink-0 px-1"
        >
          ✕
        </button>
      </header>

      {byType.size > 0 && (
        <section className="p-3 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            연결된 관계
          </div>
          <ul className="space-y-2">
            {Array.from(byType.entries()).map(([key, v]) => {
              const [type, dir] = key.split("|")
              const arrow = dir === "out" ? "→" : "←"
              return (
                <li key={key} className="text-[11px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-500 w-3 text-center">{arrow}</span>
                    <span className="text-slate-300">{EDGE_LABEL[type] ?? type}</span>
                    <span className="text-slate-500">×{v.count}</span>
                  </div>
                  {v.peers.length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-5">
                      {v.peers.map((p) => {
                        const navigable = onSelectNode && nodeById?.has(p.id)
                        const Tag = navigable ? "button" : "span"
                        return (
                          <Tag
                            key={`${key}-${p.id}`}
                            type={navigable ? "button" : undefined}
                            onClick={
                              navigable
                                ? () => {
                                    const peer = nodeById!.get(p.id)
                                    if (peer && onSelectNode) onSelectNode(peer)
                                  }
                                : undefined
                            }
                            title={p.label}
                            className={[
                              "max-w-[10rem] truncate text-[10px] px-1.5 py-0.5 rounded border",
                              navigable
                                ? "border-slate-600 bg-slate-800 text-slate-200 hover:border-cyan-500/60 hover:text-cyan-200 cursor-pointer"
                                : "border-slate-700 bg-slate-800/60 text-slate-400",
                            ].join(" ")}
                          >
                            <span className="text-slate-500 mr-1">[{p.type}]</span>
                            {p.label}
                          </Tag>
                        )
                      })}
                      {v.overflow > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500">
                          +{v.overflow}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {metaEntries.length > 0 && (
        <section className="p-3 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            메타 (그래프)
          </div>
          <dl className="space-y-1 text-[11px]">
            {metaEntries.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="text-slate-500 truncate">{k}</dt>
                <dd className="text-slate-200 break-all">{formatMetaValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* P2.1g — drill-down (DB 단건). aggregate types skip the fetch. */}
      {DRILL_SUPPORTED.has(node.type) && (
        <section className="p-3 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              원본 데이터 (DB)
            </div>
            {detailLoading && (
              <span className="text-[10px] text-slate-500">로딩…</span>
            )}
          </div>

          {detailError && (
            <div className="text-[10px] text-rose-300/80 mb-2">{detailError}</div>
          )}

          {detail && (
            <div className="space-y-3">
              {Object.keys(detail.primary).length > 0 && (
                <dl className="space-y-1 text-[11px]">
                  {Object.entries(detail.primary)
                    .filter(([k]) => !isSensitiveColumn(k))
                    .map(([k, v]) => (
                      <div key={`p-${k}`} className="grid grid-cols-[110px_1fr] gap-2">
                        <dt className="text-slate-500 truncate">{k}</dt>
                        <dd className="text-slate-200 break-all">{formatMetaValue(k, v)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              {Object.keys(detail.relations).length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">관계</div>
                  <dl className="space-y-1 text-[11px]">
                    {Object.entries(detail.relations)
                      .filter(([k]) => !isSensitiveColumn(k))
                      .map(([k, v]) => (
                        <div key={`r-${k}`} className="grid grid-cols-[110px_1fr] gap-2">
                          <dt className="text-slate-500 truncate">{k}</dt>
                          <dd className="text-slate-200 break-all">{formatMetaValue(k, v)}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              )}
              {detail.warnings.length > 0 && (
                <div className="text-[10px] text-amber-300/80">
                  경고: {detail.warnings.join(" · ")}
                </div>
              )}
              <div className="text-[10px] text-slate-600">
                source_tables: {detail.source_tables.join(", ")}
              </div>
            </div>
          )}
        </section>
      )}

      {/* P2.1p — raw JSON (developer mode) */}
      <RawJsonSection node={node} detail={detail} />

      <footer className="p-3 text-[10px] text-slate-500">
        가중치 weight={node.weight.toFixed(2)} · DB 기준 read-only
      </footer>
    </aside>
  )
}
