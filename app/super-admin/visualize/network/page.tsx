"use client"

/**
 * /super-admin/visualize/network — Phase 2.1e Jarvis network map.
 *
 * READ-ONLY. Polls /api/super-admin/visualize/graph/network every 30s
 * and renders a 2D force-directed graph. Node click opens the detail
 * panel (in-memory data only — no per-node fetch yet).
 *
 * Composition:
 *   - top bar: store selector + TimeScopeToggle + as_of badge + refresh
 *   - main:    NetworkGraph (responsive width)
 *   - aside:   NodeDetailPanel (collapsed when no selection)
 *   - bottom:  totals + truncated banner + warnings
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import AsOfBadge from "@/components/visualize/AsOfBadge"
import TimeScopeToggle from "@/components/visualize/TimeScopeToggle"
import NodeDetailPanel from "@/components/visualize/NodeDetailPanel"
import NetworkLegend from "@/components/visualize/NetworkLegend"
import OperationsSidebar from "@/components/visualize/OperationsSidebar"
import KeyboardHelpOverlay from "@/components/visualize/KeyboardHelpOverlay"
import { classifyAuditAction } from "@/lib/visualize/graph/categories"
import type {
  NetworkAuditCategory,
  NetworkGraphResponse,
  NetworkNode,
  NetworkScopeKind,
  NetworkTimeRange,
} from "@/lib/visualize/shapes"

// react-force-graph-2d uses `canvas` and inflates the bundle; lazy-load.
const NetworkGraph = dynamic(
  () => import("@/components/visualize/NetworkGraph"),
  {
    ssr: false,
    loading: () => (
      <div className="text-xs text-slate-400 p-4">그래프 엔진 로딩…</div>
    ),
  },
)

const POLL_MS = 30_000
const DEFAULT_AUDIT_CATEGORIES: NetworkAuditCategory[] = ["settlement", "payout"]

type StoreCard = {
  store_uuid: string
  store_name: string
  floor: number | null
}

type FloorGroup = { floor: number | "unknown"; stores: StoreCard[] }

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0%"
  return `${Math.round(n)}%`
}

export default function VisualizeNetworkPage() {
  const router = useRouter()

  const [stores, setStores] = useState<StoreCard[]>([])
  const [scopeKind, setScopeKind] = useState<NetworkScopeKind>("building")
  const [storeUuid, setStoreUuid] = useState<string>("")
  const [timeRange, setTimeRange] = useState<NetworkTimeRange>("today")
  // P2.1j: custom date range (yyyy-mm-dd KST). Only consulted when
  // timeRange='custom'. Server enforces ≤30 day window + within 90d.
  const [customFrom, setCustomFrom] = useState<string>("")
  const [customTo, setCustomTo] = useState<string>("")
  const [auditCategories, setAuditCategories] =
    useState<NetworkAuditCategory[]>(DEFAULT_AUDIT_CATEGORIES)
  // Building scope produces ~3500+ participated_in edges (5/session ×
  // ~700 sessions/day across 14 stores). Hide them by default in
  // building view to keep the graph readable; show in single-store view
  // where edge count is bounded.
  const [hideParticipatedIn, setHideParticipatedIn] = useState<boolean>(true)
  // P2.2: hide store nodes that have no activity today. Default ON in
  // building scope (signal-first); meaningless in store scope (single
  // store) so we just no-op the filter there.
  const [hideEmptyStores, setHideEmptyStores] = useState<boolean>(true)
  // Reset to scope-appropriate default when scope changes.
  useEffect(() => {
    setHideParticipatedIn(scopeKind === "building")
    setHideEmptyStores(scopeKind === "building")
  }, [scopeKind])

  // P2.2: keyboard help overlay.
  const [helpOpen, setHelpOpen] = useState<boolean>(false)

  // P2.1i unmask: super_admin opt-in. Off by default. Server records
  // `unmasked: true` in audit_events when on. The toggle is visually
  // tagged risky (amber) so it's not enabled accidentally.
  const [unmask, setUnmask] = useState<boolean>(false)

  // P2.1k: rolling sample of recent query_ms values from successful polls.
  // Used to surface p50 / p95 / avg in the metrics strip without a server
  // round-trip. Capped at 30 to keep the rendering cheap and to track only
  // ~last 15 minutes of activity at 30s polling.
  const QUERY_MS_HISTORY = 30
  const [queryMsHistory, setQueryMsHistory] = useState<number[]>([])

  const [data, setData] = useState<NetworkGraphResponse | null>(null)
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)

  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null)
  // P2.1u: explicit "fit to viewport" trigger — bumped to ask the
  // graph to zoom to fit the current data.
  const [fitTrigger, setFitTrigger] = useState<number>(0)
  // P2.1s: incremental label search.
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [searchOpen, setSearchOpen] = useState<boolean>(false)

  // Responsive graph width
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [graphSize, setGraphSize] = useState<{ w: number; h: number }>({ w: 800, h: 560 })
  useEffect(() => {
    if (typeof window === "undefined") return
    const onResize = () => {
      const el = containerRef.current
      if (!el) return
      const w = el.clientWidth
      const h = Math.max(420, Math.min(720, window.innerHeight - 280))
      setGraphSize({ w, h })
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // ── Load store list once via existing super-admin dashboard ──────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/super-admin/dashboard", { cache: "no-store" })
        if (res.status === 401) { router.push("/login"); return }
        if (res.status === 403) { setError("권한이 없습니다 (super_admin 전용)."); return }
        if (!res.ok) { setError("매장 목록 로드 실패"); return }
        const body = await res.json()
        if (cancelled) return
        const flat: StoreCard[] = []
        for (const f of body.floors ?? []) {
          for (const s of f.stores ?? []) {
            flat.push({
              store_uuid: s.store_uuid,
              store_name: s.store_name,
              floor: typeof f.floor === "number" ? f.floor : null,
            })
          }
        }
        setStores(flat)
      } catch {
        if (!cancelled) setError("매장 목록 로드 실패")
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Network fetch + 30s polling ──────────────────────────────────────
  const lastReqId = useRef(0)
  // P2.2 hotfix: surface slow / stuck fetches. Server query is normally
  // <2s; if a request takes longer than SLOW_THRESHOLD_MS we flip a flag
  // so the UI can replace "데이터 로딩 중..." with a clearer message and
  // a manual abort. Hard cap (FETCH_TIMEOUT_MS) prevents the page from
  // sitting in pending state forever (e.g., dev-mode first-compile).
  const SLOW_THRESHOLD_MS = 5_000
  const FETCH_TIMEOUT_MS = 25_000
  const [loadingSlow, setLoadingSlow] = useState<boolean>(false)
  const fetchGraph = useCallback(async () => {
    if (scopeKind === "store" && !storeUuid) {
      setData(null)
      return
    }
    const reqId = ++lastReqId.current
    setLoading(true)
    setLoadingSlow(false)
    // After 5s without response, flip the slow flag.
    const slowTimer = window.setTimeout(() => {
      if (reqId === lastReqId.current) setLoadingSlow(true)
    }, SLOW_THRESHOLD_MS)
    // Hard timeout via AbortController.
    const ac = new AbortController()
    const hardTimer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    try {
      const params = new URLSearchParams()
      params.set("scope", scopeKind)
      if (scopeKind === "store") params.set("store_uuid", storeUuid)
      params.set("time_range", timeRange)
      if (timeRange === "custom") {
        if (!customFrom || !customTo) {
          // Wait for the user to fill both dates before issuing a fetch.
          setData(null)
          setLoading(false)
          window.clearTimeout(slowTimer)
          window.clearTimeout(hardTimer)
          return
        }
        params.set("from", customFrom)
        params.set("to", customTo)
      }
      if (auditCategories.length > 0) {
        params.set("audit_categories", auditCategories.join(","))
      }
      // include audit only if at least one category is selected
      const include = ["store", "manager", "hostess", "staff", "session", "settlement", "payout"]
      if (auditCategories.length > 0) include.push("audit")
      params.set("include", include.join(","))
      if (unmask) params.set("unmask", "true")

      const url = `/api/super-admin/visualize/graph/network?${params.toString()}`
      const res = await apiFetch(url, { cache: "no-store", signal: ac.signal })
      if (reqId !== lastReqId.current) return
      if (res.status === 401) { router.push("/login"); return }
      if (res.status === 403) { setError("권한이 없습니다."); setData(null); return }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message || `요청 실패 (${res.status})`)
        setData(null)
        return
      }
      const body = (await res.json()) as NetworkGraphResponse
      setData(body)
      setError("")
      // Append query_ms to rolling history (drop oldest beyond cap).
      const qm = body.totals?.query_ms
      if (typeof qm === "number" && Number.isFinite(qm)) {
        setQueryMsHistory((prev) => {
          const next = [...prev, qm]
          return next.length > QUERY_MS_HISTORY ? next.slice(next.length - QUERY_MS_HISTORY) : next
        })
      }
      // Drop selection if the chosen node is no longer in the graph.
      if (selectedNode) {
        const stillThere = body.nodes.some((n) => n.id === selectedNode.id)
        if (!stillThere) setSelectedNode(null)
      }
    } catch (e) {
      const isAbort =
        e instanceof DOMException && e.name === "AbortError"
      if (isAbort) {
        setError(`응답이 ${FETCH_TIMEOUT_MS / 1000}초 안에 오지 않아 중단됨. 새로고침 또는 잠시 후 다시 시도하세요.`)
      } else {
        setError("네트워크 그래프 로드 실패")
      }
      setData(null)
    } finally {
      window.clearTimeout(slowTimer)
      window.clearTimeout(hardTimer)
      if (reqId === lastReqId.current) {
        setLoading(false)
        setLoadingSlow(false)
      }
    }
    // selectedNode kept out of deps on purpose (stale-prune handled inside)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind, storeUuid, timeRange, customFrom, customTo, auditCategories, unmask, router])

  useEffect(() => {
    fetchGraph()
    if (scopeKind === "store" && !storeUuid) return
    const t = window.setInterval(fetchGraph, POLL_MS)
    return () => window.clearInterval(t)
  }, [fetchGraph, scopeKind, storeUuid])

  // P2.1m — keyboard shortcuts. Bound at the document level. Ignored
  // when focus is inside a form control so date-input / select typing
  // is not hijacked.
  useEffect(() => {
    function isInForm(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }
    function onKey(e: KeyboardEvent) {
      if (isInForm(e.target)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === "Escape") {
        if (selectedNode) {
          setSelectedNode(null)
          e.preventDefault()
        }
        return
      }
      switch (e.key.toLowerCase()) {
        case "b": setScopeKind("building"); e.preventDefault(); break
        case "s": setScopeKind("store"); e.preventDefault(); break
        case "1": setTimeRange("today"); e.preventDefault(); break
        case "2": setTimeRange("yesterday"); e.preventDefault(); break
        case "3": setTimeRange("last_7_days"); e.preventDefault(); break
        case "4": setTimeRange("this_month"); e.preventDefault(); break
        case "5": setTimeRange("custom"); e.preventDefault(); break
        case "u": setUnmask((prev) => !prev); e.preventDefault(); break
        case "p": setHideParticipatedIn((prev) => !prev); e.preventDefault(); break
        case "e": setHideEmptyStores((prev) => !prev); e.preventDefault(); break
        case "r": fetchGraph(); e.preventDefault(); break
        case "f": setFitTrigger((v) => v + 1); e.preventDefault(); break
        case "?":
        case "/": setHelpOpen((prev) => !prev); e.preventDefault(); break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedNode, fetchGraph])

  const nodeLabelMap = useMemo(() => {
    const m = new Map<string, { label: string; type: string }>()
    if (!data) return m
    for (const n of data.nodes) m.set(n.id, { label: n.label, type: n.type })
    return m
  }, [data])
  // P2.1l: full node lookup for detail-panel peer navigation.
  const nodeById = useMemo(() => {
    const m = new Map<string, NetworkNode>()
    if (!data) return m
    for (const n of data.nodes) m.set(n.id, n)
    return m
  }, [data])

  // P2.1t: when scope=store and a store_uuid is selected, auto-select
  // the corresponding store node on first data arrival so the operator
  // sees that store's detail immediately. Skipped if the user already
  // has a selection (their explicit click wins). Resets when scope/
  // store_uuid changes.
  useEffect(() => {
    if (scopeKind !== "store") return
    if (!storeUuid) return
    if (selectedNode) return
    if (!data) return
    const target = data.nodes.find(
      (n) => n.type === "store" && n.id === `store:${storeUuid}`,
    )
    if (target) setSelectedNode(target)
    // selectedNode intentionally omitted: we only want to fire when the
    // store/scope changes or fresh data arrives, not when user picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind, storeUuid, data])

  // P2.1k: derived percentiles from query_ms history.
  const queryMsStats = useMemo(() => {
    if (queryMsHistory.length === 0) return null
    const sorted = [...queryMsHistory].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const avg = sum / sorted.length
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)]
    const max = sorted[sorted.length - 1]
    return { count: sorted.length, avg: Math.round(avg), p50, p95, max }
  }, [queryMsHistory])

  // P2.2: per-store activity count (sessions + settlements + payouts +
  // person nodes attached to that store). Used by NetworkGraph to dim
  // empty stores and by the page to decide which store nodes to filter
  // out when `hideEmptyStores` is on.
  const storeActivityByUuid = useMemo(() => {
    const m = new Map<string, number>()
    if (!data) return m
    for (const n of data.nodes) {
      if (n.type === "store") continue
      const su = n.store_uuid
      if (!su) continue
      m.set(su, (m.get(su) ?? 0) + 1)
    }
    return m
  }, [data])

  // P2.2: filter empty stores out of the rendered graph (sidebar still
  // shows ALL stores for triage). When the user picks 단일 매장, we keep
  // the chosen store regardless of activity so the graph doesn't go
  // empty on quiet stores.
  const visibleNodes = useMemo(() => {
    if (!data) return []
    if (!hideEmptyStores || scopeKind === "store") return data.nodes
    return data.nodes.filter((n) => {
      if (n.type !== "store") return true
      if (!n.store_uuid) return true
      return (storeActivityByUuid.get(n.store_uuid) ?? 0) > 0
    })
  }, [data, hideEmptyStores, scopeKind, storeActivityByUuid])
  const hiddenEmptyStoreCount = useMemo(() => {
    if (!data) return 0
    if (!hideEmptyStores || scopeKind === "store") return 0
    return data.nodes.filter((n) => n.type === "store").length -
      visibleNodes.filter((n) => n.type === "store").length
  }, [data, hideEmptyStores, scopeKind, visibleNodes])

  // Client-side edge filter for participated_in. Server still emits these
  // (they affect cap accounting), but UI can collapse them locally for
  // legibility without re-fetching.
  const visibleEdges = useMemo(() => {
    if (!data) return []
    let edges = data.edges
    if (hideParticipatedIn) edges = edges.filter((e) => e.type !== "participated_in")
    // Drop edges referencing filtered-out store nodes so force-graph
    // doesn't see orphan endpoints.
    if (hideEmptyStores && scopeKind === "building") {
      const visibleIds = new Set(visibleNodes.map((n) => n.id))
      edges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    }
    return edges
  }, [data, hideParticipatedIn, hideEmptyStores, scopeKind, visibleNodes])
  const hiddenParticipatedCount = useMemo(() => {
    if (!data) return 0
    if (!hideParticipatedIn) return 0
    return data.edges.length - visibleEdges.length
  }, [data, visibleEdges.length, hideParticipatedIn])

  // P2.1s: search match list — case-insensitive label substring match.
  // Capped to 12 hits to keep the dropdown light.
  const searchHits = useMemo(() => {
    if (!data) return [] as NetworkNode[]
    const q = searchQuery.trim().toLowerCase()
    if (q.length === 0) return [] as NetworkNode[]
    const out: NetworkNode[] = []
    for (const n of data.nodes) {
      if (out.length >= 12) break
      if (n.label.toLowerCase().includes(q)) out.push(n)
    }
    return out
  }, [data, searchQuery])

  // P2.1n: audit nodes counted per category for toggle button labels.
  // Classification reuses server-side prefix rules (categories.ts is a
  // pure module — safe to import client-side).
  const auditCountByCategory = useMemo(() => {
    const m: Partial<Record<NetworkAuditCategory, number>> = {}
    if (!data) return m
    for (const n of data.nodes) {
      if (n.type !== "audit") continue
      const last = n.meta?.last_action
      if (typeof last !== "string") continue
      const cat = classifyAuditAction(last)
      m[cat] = (m[cat] ?? 0) + 1
    }
    return m
  }, [data])

  const totals = data?.totals
  const truncated = !!totals?.truncated
  const warnings = data?.warnings ?? []

  function toggleCategory(cat: NetworkAuditCategory) {
    setAuditCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  return (
    <main className="p-5 max-w-[1400px] mx-auto space-y-4 bg-[#0a0f1c] min-h-screen text-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">
            <Link href="/super-admin/visualize" className="hover:underline">관제 시각화</Link>
            <span className="mx-1">›</span>
            네트워크 맵
          </div>
          <h1 className="text-xl font-semibold text-slate-100">Jarvis 네트워크 맵</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            DB 저장값만 표시. 정산/지급/세션 logic 재계산 없음. PII 기본 마스킹.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AsOfBadge asOf={data?.as_of ?? null} />
          {loading && <span className="text-[11px] text-slate-400">갱신 중…</span>}
        </div>
      </header>

      {/* Selectors */}
      <section className="flex flex-wrap items-end gap-3 rounded border border-slate-800 bg-slate-900/60 p-3">
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">스코프</label>
          <div className="inline-flex rounded border border-slate-700 overflow-hidden">
            <button
              onClick={() => setScopeKind("building")}
              className={`text-xs px-2.5 py-1 ${
                scopeKind === "building" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:bg-slate-800"
              }`}
            >빌딩 전체</button>
            <button
              onClick={() => setScopeKind("store")}
              className={`text-xs px-2.5 py-1 ${
                scopeKind === "store" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:bg-slate-800"
              }`}
            >단일 매장</button>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">매장</label>
          <select
            value={storeUuid}
            onChange={(e) => setStoreUuid(e.target.value)}
            disabled={scopeKind !== "store"}
            className="text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 disabled:opacity-50"
          >
            <option value="">(매장 선택)</option>
            {stores.map((s) => (
              <option key={s.store_uuid} value={s.store_uuid}>
                {s.floor != null ? `${s.floor}F ` : ""}{s.store_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">시간 범위</label>
          <TimeScopeToggle
            value={timeRange}
            onChange={setTimeRange}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={({ from, to }) => {
              setCustomFrom(from)
              setCustomTo(to)
            }}
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">감사 카테고리</label>
          <div className="inline-flex rounded border border-slate-700 overflow-hidden">
            {(["settlement", "payout", "participant", "access"] as NetworkAuditCategory[]).map((c) => {
              const active = auditCategories.includes(c)
              const count = active ? auditCountByCategory[c] ?? 0 : null
              return (
                <button
                  key={c}
                  onClick={() => toggleCategory(c)}
                  className={`text-xs px-2.5 py-1 inline-flex items-center gap-1 ${
                    active ? "bg-violet-500/20 text-violet-200" : "text-slate-400 hover:bg-slate-800"
                  }`}
                  title={active ? `켜짐 (현재 ${count}개 노드)` : "꺼짐 (클릭해 켜기)"}
                >
                  <span>{c}</span>
                  {count != null && (
                    <span className="text-[10px] text-violet-300/80">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideParticipatedIn}
            onChange={(e) => setHideParticipatedIn(e.target.checked)}
            className="accent-cyan-500"
          />
          참여 엣지 숨김
          {hiddenParticipatedCount > 0 && (
            <span className="text-slate-500">({hiddenParticipatedCount})</span>
          )}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideEmptyStores}
            onChange={(e) => setHideEmptyStores(e.target.checked)}
            disabled={scopeKind === "store"}
            className="accent-cyan-500 disabled:opacity-50"
          />
          빈 매장 숨김
          {hiddenEmptyStoreCount > 0 && (
            <span className="text-slate-500">({hiddenEmptyStoreCount})</span>
          )}
        </label>
        <label
          className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${
            unmask ? "text-amber-300" : "text-slate-400"
          }`}
          title="super_admin 전용 · 활성화 시 audit_events 에 unmasked:true 기록"
        >
          <input
            type="checkbox"
            checked={unmask}
            onChange={(e) => setUnmask(e.target.checked)}
            className="accent-amber-500"
          />
          이름 unmask
          {unmask && (
            <span className="text-[10px] px-1 py-0 rounded bg-amber-500/20 text-amber-200">
              audit 기록
            </span>
          )}
        </label>
        <div className="relative">
          <label className="text-[11px] text-slate-400 block mb-1">노드 검색</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              // delay close so click on result registers
              window.setTimeout(() => setSearchOpen(false), 150)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchHits.length > 0) {
                setSelectedNode(searchHits[0])
                setSearchQuery("")
                setSearchOpen(false)
                e.preventDefault()
              } else if (e.key === "Escape") {
                setSearchQuery("")
                setSearchOpen(false)
              }
            }}
            placeholder="라벨 검색…"
            className="text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 w-44"
          />
          {searchOpen && searchHits.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 rounded border border-slate-700 bg-slate-900 shadow-lg max-h-72 overflow-y-auto">
              {searchHits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      setSelectedNode(h)
                      setSearchQuery("")
                      setSearchOpen(false)
                    }}
                    className="w-full text-left text-[11px] px-2 py-1 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5"
                  >
                    <span className="text-[10px] text-slate-500 w-12 shrink-0 truncate">{h.type}</span>
                    <span className="truncate">{h.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => setFitTrigger((v) => v + 1)}
          className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
          title="그래프를 화면에 맞춰 줌 리셋"
        >전체 보기</button>
        <button
          onClick={fetchGraph}
          className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
        >새로고침</button>
      </section>

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm p-3">
          {error}
        </div>
      )}

      {truncated && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs p-2">
          노드/엣지 cap 초과로 일부가 제외되었습니다. 시간 범위를 줄이거나 단일 매장으로 좁혀보세요.
          {totals && (
            <span className="ml-2 text-amber-100/80">
              (kept {totals.nodes.total} nodes / {totals.edges.total} edges)
            </span>
          )}
        </div>
      )}

      {/* Main row: operations sidebar (left) + graph (center) + detail (right) */}
      <section className="flex flex-col lg:flex-row gap-3">
        {/* P2.2: ops triage rail — anomaly summary + per-store activity. */}
        <OperationsSidebar data={data} onSelectNode={setSelectedNode} />

        <div ref={containerRef} className="flex-1 min-w-0 relative">
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <NetworkLegend />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
              title="단축키 / 읽는 법 (?)"
            >
              ? 도움말
            </button>
          </div>
          {data ? (
            <NetworkGraph
              nodes={visibleNodes}
              edges={visibleEdges}
              width={graphSize.w}
              height={graphSize.h}
              selectedNodeId={selectedNode?.id ?? null}
              onNodeSelect={setSelectedNode}
              fitTrigger={fitTrigger}
              storeActivityByUuid={storeActivityByUuid}
            />
          ) : (
            <div
              className="rounded border border-dashed border-slate-700 flex flex-col items-center justify-center text-sm text-slate-400 gap-2 px-4 text-center"
              style={{ height: graphSize.h }}
            >
              {scopeKind === "store" && !storeUuid ? (
                <span>매장을 선택하세요.</span>
              ) : loadingSlow ? (
                <>
                  <span className="text-amber-300">조회가 평소보다 오래 걸리고 있습니다…</span>
                  <span className="text-[11px] text-slate-500">
                    개발 모드 첫 컴파일이거나 네트워크 지연일 수 있습니다. 25초 후 자동 중단됩니다.
                  </span>
                  <button
                    onClick={fetchGraph}
                    className="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
                  >
                    다시 시도
                  </button>
                </>
              ) : (
                <span>데이터 로딩 중…</span>
              )}
            </div>
          )}
        </div>
        <div className="lg:w-80 shrink-0">
          {selectedNode ? (
            <NodeDetailPanel
              node={selectedNode}
              edges={visibleEdges}
              nodeLabelMap={nodeLabelMap}
              nodeById={nodeById}
              onSelectNode={setSelectedNode}
              unmask={unmask}
              onClose={() => setSelectedNode(null)}
            />
          ) : (
            <div className="rounded border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-500">
              노드를 클릭하면 상세 정보가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </section>

      {/* Totals strip */}
      {totals && (
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {Object.entries(totals.nodes.by_type).map(([t, n]) => (
            <div key={`n-${t}`} className="rounded border border-slate-800 bg-slate-900/60 p-2">
              <div className="text-[10px] text-slate-500">{t}</div>
              <div className="text-sm font-semibold text-slate-100">{n}</div>
            </div>
          ))}
        </section>
      )}

      {totals && (
        <section className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>nodes: {totals.nodes.total}</span>
          <span>edges: {totals.edges.total}</span>
          <span>query_ms: {totals.query_ms}</span>
          {data && <span>source_tables: {data.source_tables.length}</span>}
          {data && (
            <span>
              query_share: {fmtPct(((totals.query_ms ?? 0) / POLL_MS) * 100)}
            </span>
          )}
          {queryMsStats && queryMsStats.count > 1 && (
            <span title={`최근 ${queryMsStats.count}회 폴링 분포`}>
              · history p50={queryMsStats.p50} p95={queryMsStats.p95} avg={queryMsStats.avg} max={queryMsStats.max} (n={queryMsStats.count})
            </span>
          )}
        </section>
      )}

      {warnings.length > 0 && (
        <section className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs font-medium text-amber-300 mb-2">
            경고 ({warnings.length})
          </div>
          <ul className="space-y-1 text-[11px] text-amber-100/80">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400 font-mono shrink-0">{w.type}</span>
                <span className="flex-1 break-words">{w.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="text-[10px] text-slate-600 pt-2 border-t border-slate-800 space-y-0.5">
        <div>
          scope={scopeKind} · range={timeRange} · audit_categories=[{auditCategories.join(",") || "—"}] · stored sankey 와 같은 read-only 격리 레이어 · DB 기준
        </div>
        <div>
          단축키 — <kbd className="px-1 bg-slate-800 rounded">b</kbd>/<kbd className="px-1 bg-slate-800 rounded">s</kbd> scope · <kbd className="px-1 bg-slate-800 rounded">1</kbd>~<kbd className="px-1 bg-slate-800 rounded">5</kbd> 시간 · <kbd className="px-1 bg-slate-800 rounded">p</kbd> 참여엣지 · <kbd className="px-1 bg-slate-800 rounded">e</kbd> 빈매장 · <kbd className="px-1 bg-slate-800 rounded">u</kbd> unmask · <kbd className="px-1 bg-slate-800 rounded">r</kbd> 새로고침 · <kbd className="px-1 bg-slate-800 rounded">f</kbd> 전체 · <kbd className="px-1 bg-slate-800 rounded">?</kbd> 도움말 · <kbd className="px-1 bg-slate-800 rounded">esc</kbd> 닫기
        </div>
      </footer>

      <KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  )
}
