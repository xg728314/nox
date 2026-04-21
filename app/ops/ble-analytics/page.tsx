"use client"

/**
 * BLE Analytics Dashboard — /ops/ble-analytics
 *
 * Read-only dashboard that surfaces ble_feedback and
 * ble_presence_corrections signals as operational quality metrics.
 * Never mutates business data. Visibility is enforced by every backing
 * API route + middleware (owner / manager → own store, super-admin →
 * any store via optional `store_uuid` filter).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

// ───────────────────────────────────────────────────────────────────
// Types mirroring the 6 API route responses. Kept in this file to
// avoid a new types module for a single-page dashboard.
// ───────────────────────────────────────────────────────────────────

type Filters = {
  from: string // ISO
  to: string   // ISO
  floor: number | "all"
  store_uuid: string
  gateway_id: string
  reason: string
  corrected_by: string
  zone_from: string
  zone_to: string
}

type OverviewResp = {
  window: { from: string; to: string }
  scope: { storeFilter: string | null; isSuperAdmin: boolean; role: string }
  kpis: {
    corrections_total: number
    feedback_total: number
    feedback_positive: number
    feedback_negative: number
    accuracy_rate: number
    top_problem_zone: string | null
    top_problem_zone_count: number
    top_problem_gateway: string | null
    top_problem_gateway_count: number
    me_contribution: number
  }
  recommendations: Array<{ code: string; severity: "info"|"warning"|"critical"; message: string; context?: Record<string, unknown> }>
  saturated: boolean
}

type TransitionsResp = {
  zones: string[]
  rows: Array<{ from_zone: string; to_zone: string; count: number }>
  total: number
}

type GatewayRow = {
  gateway_id: string
  display_name: string | null
  gateway_type: string | null
  room_uuid: string | null
  room_name: string | null
  floor_no: number | null
  store_uuid: string | null
  store_name: string | null
  related_events: number
  correction_count: number
  correction_rate: number
  top_transition: { from: string; to: string; count: number } | null
  status: "normal"|"warning"|"critical"
}

type GatewaysResp = { rows: GatewayRow[] }

type TimelineResp = {
  buckets: Array<{ hour_iso: string; corrections: number; positives: number; negatives: number }>
  peak: { hour_iso: string; corrections: number; negatives: number } | null
}

type FloorMapResp = {
  floors: Array<{
    floor: number
    zones: Array<{ zone: string; error_count: number }>
    rooms: Array<{ room_uuid: string; room_name: string | null; correction_count: number }>
  }>
}

type LogsResp = {
  page: number; page_size: number; total: number
  rows: Array<{
    id: string
    at: string
    kind: "correction"|"feedback"
    feedback_type: "positive"|"negative"|null
    membership: { id: string; display_name: string | null } | null
    floor_no: number | null
    store_name: string | null
    original: { zone: string | null; room_name: string | null }
    corrected: { zone: string | null; room_name: string | null } | null
    reason: string | null
    note: string | null
    actor: { id: string; display_name: string | null } | null
    gateway_id: string | null
    source: string | null
  }>
}

// ───────────────────────────────────────────────────────────────────
// Filter plumbing — URL-backed for shareable links.
// ───────────────────────────────────────────────────────────────────

function defaultFilters(): Filters {
  const now = new Date()
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  from.setHours(0, 0, 0, 0)
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    floor: "all",
    store_uuid: "",
    gateway_id: "",
    reason: "",
    corrected_by: "",
    zone_from: "",
    zone_to: "",
  }
}

function parseFiltersFromUrl(): Filters {
  if (typeof window === "undefined") return defaultFilters()
  const sp = new URLSearchParams(window.location.search)
  const base = defaultFilters()
  const getIso = (k: string, fallback: string) => {
    const v = sp.get(k)
    if (!v) return fallback
    const t = Date.parse(v)
    return Number.isFinite(t) ? new Date(t).toISOString() : fallback
  }
  const floorRaw = sp.get("floor")
  const floor: number | "all" =
    floorRaw && floorRaw !== "all" && Number.isFinite(Number(floorRaw))
      ? Number(floorRaw)
      : "all"
  return {
    from: getIso("from", base.from),
    to: getIso("to", base.to),
    floor,
    store_uuid: sp.get("store_uuid") ?? "",
    gateway_id: sp.get("gateway_id") ?? "",
    reason: sp.get("reason") ?? "",
    corrected_by: sp.get("corrected_by") ?? "",
    zone_from: sp.get("zone_from") ?? "",
    zone_to: sp.get("zone_to") ?? "",
  }
}

function filtersToQuery(f: Filters): string {
  const sp = new URLSearchParams()
  sp.set("from", f.from)
  sp.set("to", f.to)
  if (f.floor !== "all") sp.set("floor", String(f.floor))
  if (f.store_uuid) sp.set("store_uuid", f.store_uuid)
  if (f.gateway_id) sp.set("gateway_id", f.gateway_id)
  if (f.reason) sp.set("reason", f.reason)
  if (f.corrected_by) sp.set("corrected_by", f.corrected_by)
  if (f.zone_from) sp.set("zone_from", f.zone_from)
  if (f.zone_to) sp.set("zone_to", f.zone_to)
  return sp.toString()
}

function toLocalDT(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalDT(v: string): string {
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString()
}

const ZONE_LABEL: Record<string, string> = {
  room: "방",
  counter: "카운터",
  restroom: "화장실",
  elevator: "엘리베이터",
  external_floor: "외부(타층)",
  lounge: "라운지",
  unknown: "감지",
  mid_out: "이탈",
}
const labelZone = (z: string | null | undefined) => (!z ? "—" : ZONE_LABEL[z] ?? z)

// ───────────────────────────────────────────────────────────────────
// Generic fetch hook.
// ───────────────────────────────────────────────────────────────────

function useAnalyticsSection<T>(path: string, qs: string): { data: T | null; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`${path}?${qs}`)
      if (!r.ok) {
        setError(r.status === 401 || r.status === 403 ? "접근 권한이 없습니다." : `로드 실패 (${r.status})`)
        setData(null)
        return
      }
      const body = (await r.json()) as T
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류")
    } finally {
      setLoading(false)
    }
  }, [path, qs])

  useEffect(() => { void refresh() }, [refresh])

  return { data, loading, error, refresh }
}

// ───────────────────────────────────────────────────────────────────
// Sub-components (inlined).
// ───────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange, onReset }: {
  filters: Filters
  onChange: (next: Filters) => void
  onReset: () => void
}) {
  const setF = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const floors: Array<number | "all"> = ["all", 5, 6, 7, 8]
  return (
    <div className="flex items-end flex-wrap gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0a0c1a]">
      <Field label="시작">
        <input
          type="datetime-local"
          value={toLocalDT(filters.from)}
          onChange={e => setF({ from: fromLocalDT(e.target.value) })}
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100"
        />
      </Field>
      <Field label="종료">
        <input
          type="datetime-local"
          value={toLocalDT(filters.to)}
          onChange={e => setF({ to: fromLocalDT(e.target.value) })}
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100"
        />
      </Field>
      <Field label="층">
        <div className="flex items-center gap-1">
          {floors.map(fl => (
            <button
              key={String(fl)}
              type="button"
              onClick={() => setF({ floor: fl })}
              className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${
                filters.floor === fl
                  ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-100"
                  : "bg-white/[0.04] border-white/10 text-slate-400 hover:text-slate-200"
              }`}
            >{fl === "all" ? "전체" : `${fl}F`}</button>
          ))}
        </div>
      </Field>
      <Field label="매장 UUID (super-admin)">
        <input
          type="text"
          value={filters.store_uuid}
          onChange={e => setF({ store_uuid: e.target.value.trim() })}
          placeholder="비우면 전체"
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[220px]"
        />
      </Field>
      <Field label="게이트웨이">
        <input
          type="text"
          value={filters.gateway_id}
          onChange={e => setF({ gateway_id: e.target.value.trim() })}
          placeholder="gateway_id"
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[160px]"
        />
      </Field>
      <Field label="사유">
        <input
          type="text"
          value={filters.reason}
          onChange={e => setF({ reason: e.target.value })}
          placeholder="화장실 오탐…"
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[140px]"
        />
      </Field>
      <Field label="수정자 membership">
        <input
          type="text"
          value={filters.corrected_by}
          onChange={e => setF({ corrected_by: e.target.value.trim() })}
          placeholder="uuid"
          className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[200px]"
        />
      </Field>
      <Field label="zone from→to">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={filters.zone_from}
            onChange={e => setF({ zone_from: e.target.value.trim() })}
            placeholder="from"
            className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[90px]"
          />
          <span className="text-slate-500">→</span>
          <input
            type="text"
            value={filters.zone_to}
            onChange={e => setF({ zone_to: e.target.value.trim() })}
            placeholder="to"
            className="px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-slate-100 w-[90px]"
          />
        </div>
      </Field>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-slate-200 border border-white/10"
        >초기화</button>
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
      <span>{label}</span>
      {children}
    </label>
  )
}

function KpiRow({ data, loading, error }: { data: OverviewResp | null; loading: boolean; error: string | null }) {
  if (error) return <div className="px-4 py-3 text-[11px] text-red-300">{error}</div>
  if (loading && !data) return <Skeleton h={70} />
  if (!data) return null
  const pct = Math.round(Math.max(0, Math.min(1, data.kpis.accuracy_rate)) * 100)
  const accCls = pct >= 90 ? "text-emerald-300" : pct >= 70 ? "text-amber-300" : "text-red-300"
  return (
    <div className="grid gap-3 px-4 py-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
      <KpiCard label="BLE 정확도" value={`${pct}%`} valueCls={accCls}
        sub={`+${data.kpis.feedback_positive} / −${data.kpis.feedback_negative + data.kpis.corrections_total}`}
      />
      <KpiCard label="수정" value={`${data.kpis.corrections_total}건`} valueCls="text-amber-300" sub="window 기간" />
      <KpiCard label="피드백" value={`${data.kpis.feedback_total}건`} valueCls="text-cyan-300"
        sub={`👍${data.kpis.feedback_positive} · 👎${data.kpis.feedback_negative}`}
      />
      <KpiCard
        label="주 문제 ZONE"
        value={labelZone(data.kpis.top_problem_zone)}
        valueCls="text-red-300"
        sub={data.kpis.top_problem_zone_count > 0 ? `× ${data.kpis.top_problem_zone_count}` : "—"}
      />
      <KpiCard
        label="주 문제 게이트웨이"
        value={data.kpis.top_problem_gateway ?? "—"}
        valueCls="text-fuchsia-300"
        sub={data.kpis.top_problem_gateway_count > 0 ? `× ${data.kpis.top_problem_gateway_count}` : "—"}
      />
      <KpiCard label="내 기여" value={`${data.kpis.me_contribution}건`} valueCls="text-slate-100" sub="기간 내" />
    </div>
  )
}
function KpiCard({ label, value, valueCls, sub }: { label: string; value: string; valueCls: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-[20px] font-bold tabular-nums mt-0.5 ${valueCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Recommendations({ data }: { data: OverviewResp | null }) {
  if (!data || data.recommendations.length === 0) return null
  return (
    <div className="px-4 pb-3">
      <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
        <div className="text-[11px] font-bold text-slate-100 mb-1.5">추천</div>
        <div className="space-y-1">
          {data.recommendations.map((r, i) => {
            const cls = r.severity === "critical" ? "border-red-500/45 bg-red-500/10 text-red-200"
              : r.severity === "warning" ? "border-amber-500/45 bg-amber-500/10 text-amber-200"
              : "border-white/10 bg-white/[0.04] text-slate-300"
            return (
              <div key={i} className={`text-[11px] px-2 py-1.5 rounded-md border ${cls}`}>
                <span className="mr-1 text-[10px] opacity-80">[{r.severity}]</span>{r.message}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TransitionMatrix({ filters, qs, onCellClick }: {
  filters: Filters
  qs: string
  onCellClick: (from: string, to: string) => void
}) {
  const { data, loading, error } = useAnalyticsSection<TransitionsResp>("/api/ops/ble-analytics/transitions", qs)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3 min-h-[240px]">
      <div className="text-[11px] font-bold text-slate-100 mb-2 flex items-center justify-between">
        <span>Zone 전이 매트릭스</span>
        <span className="text-[10px] text-slate-500">{data?.total ?? 0}건</span>
      </div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {loading && !data && <Skeleton h={160} />}
      {data && data.rows.length === 0 && <div className="text-[11px] text-slate-500 py-8 text-center">기간 내 수정 기록이 없습니다.</div>}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500">
                <th className="px-2 py-1 text-left w-[100px]">원래 →</th>
                {data.zones.map(z => <th key={z} className="px-2 py-1 text-center">{labelZone(z)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.zones.map(from => (
                <tr key={from} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1 text-slate-300">{labelZone(from)}</td>
                  {data.zones.map(to => {
                    const hit = data.rows.find(r => r.from_zone === from && r.to_zone === to)
                    const count = hit?.count ?? 0
                    if (count === 0) return <td key={to} className="px-2 py-1 text-center text-slate-700">·</td>
                    const sel = filters.zone_from === from && filters.zone_to === to
                    return (
                      <td key={to} className="px-0.5 py-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => onCellClick(from, to)}
                          className={`w-full px-2 py-1 rounded-md text-[11px] font-bold tabular-nums transition-all ${
                            sel
                              ? "bg-cyan-500/30 border border-cyan-400/60 text-cyan-100"
                              : "bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25"
                          }`}
                          title={`${labelZone(from)} → ${labelZone(to)} · ${count}건 (클릭 필터)`}
                        >{count}</button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GatewayTable({ qs }: { qs: string }) {
  const { data, loading, error } = useAnalyticsSection<GatewaysResp>("/api/ops/ble-analytics/gateways", qs)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3 min-h-[240px]">
      <div className="text-[11px] font-bold text-slate-100 mb-2">게이트웨이 랭킹</div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {loading && !data && <Skeleton h={160} />}
      {data && data.rows.length === 0 && <div className="text-[11px] text-slate-500 py-8 text-center">기간 내 이벤트가 있는 게이트웨이가 없습니다.</div>}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.06]">
                <th className="px-2 py-1 text-left">게이트웨이</th>
                <th className="px-2 py-1 text-left">층/매장/방</th>
                <th className="px-2 py-1 text-center">유형</th>
                <th className="px-2 py-1 text-right">연관</th>
                <th className="px-2 py-1 text-right">수정</th>
                <th className="px-2 py-1 text-right">수정률</th>
                <th className="px-2 py-1 text-left">Top 전이</th>
                <th className="px-2 py-1 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const cls = r.status === "critical" ? "text-red-300" : r.status === "warning" ? "text-amber-300" : "text-emerald-300"
                return (
                  <tr key={r.gateway_id} className="border-b border-white/[0.03]">
                    <td className="px-2 py-1 text-slate-100 font-mono">{r.gateway_id}</td>
                    <td className="px-2 py-1 text-slate-400">
                      {[r.floor_no ? `${r.floor_no}F` : null, r.store_name, r.room_name].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-1 text-center text-slate-300">{r.gateway_type ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.related_events}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-amber-300">{r.correction_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {(r.correction_rate * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-1 text-slate-400">
                      {r.top_transition
                        ? `${labelZone(r.top_transition.from)} → ${labelZone(r.top_transition.to)} × ${r.top_transition.count}`
                        : "—"}
                    </td>
                    <td className={`px-2 py-1 text-center font-semibold ${cls}`}>{r.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FloorErrorMap({ qs }: { qs: string }) {
  const { data, loading, error } = useAnalyticsSection<FloorMapResp>("/api/ops/ble-analytics/floor-map", qs)
  const [floor, setFloor] = useState<5 | 6 | 7 | 8>(5)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-slate-100">층별 에러 맵</span>
        <div className="flex items-center gap-1">
          {[5, 6, 7, 8].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setFloor(n as 5|6|7|8)}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                floor === n
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-100"
                  : "bg-white/[0.04] border-white/10 text-slate-400 hover:text-slate-200"
              }`}
            >{n}F</button>
          ))}
        </div>
      </div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {loading && !data && <Skeleton h={120} />}
      {data && (() => {
        const fl = data.floors.find(f => f.floor === floor)
        if (!fl || (fl.zones.length === 0 && fl.rooms.length === 0)) {
          return <div className="text-[11px] text-slate-500 py-4 text-center">이 층에 관찰된 오류가 없습니다.</div>
        }
        return (
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">Zone 오류</div>
              <div className="flex flex-wrap gap-1">
                {fl.zones.map(z => (
                  <span
                    key={z.zone}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-red-500/40 bg-red-500/10 text-red-200 text-[11px] font-semibold"
                  >
                    ⚠ {labelZone(z.zone)} · {z.error_count}
                  </span>
                ))}
                {fl.zones.length === 0 && <span className="text-[11px] text-slate-600">—</span>}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">방별 수정</div>
              <div className="flex flex-wrap gap-1">
                {fl.rooms.map(r => (
                  <span
                    key={r.room_uuid}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px]"
                  >
                    {r.room_name ?? r.room_uuid.slice(0, 6)} · {r.correction_count}
                  </span>
                ))}
                {fl.rooms.length === 0 && <span className="text-[11px] text-slate-600">—</span>}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Timeline({ qs }: { qs: string }) {
  const { data, loading, error } = useAnalyticsSection<TimelineResp>("/api/ops/ble-analytics/timeline", qs)
  const maxVal = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.buckets.map(b => b.corrections + b.negatives + b.positives))
  }, [data])
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
      <div className="text-[11px] font-bold text-slate-100 mb-2">시간대별 추이</div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {loading && !data && <Skeleton h={120} />}
      {data && (
        <>
          <div className="flex items-end gap-[2px] h-[80px]">
            {data.buckets.map(b => {
              const hCorr = (b.corrections / maxVal) * 100
              const hNeg = (b.negatives / maxVal) * 100
              const hPos = (b.positives / maxVal) * 100
              return (
                <div key={b.hour_iso} title={`${new Date(b.hour_iso).toLocaleString("ko-KR")} · 수정 ${b.corrections} · 👎 ${b.negatives} · 👍 ${b.positives}`}
                  className="flex-1 flex flex-col-reverse items-center gap-[1px] min-w-[2px]">
                  {b.positives > 0 && <div style={{ height: `${hPos}%` }} className="w-full bg-emerald-500/60" />}
                  {b.negatives > 0 && <div style={{ height: `${hNeg}%` }} className="w-full bg-red-500/70" />}
                  {b.corrections > 0 && <div style={{ height: `${hCorr}%` }} className="w-full bg-amber-500/80" />}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/80" /> 수정</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/70" /> 부정 피드백</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/60" /> 긍정 피드백</span>
            {data.peak && (
              <span className="ml-auto text-amber-300">
                ⚠ 피크: {new Date(data.peak.hour_iso).toLocaleString("ko-KR")} ({data.peak.corrections + data.peak.negatives}건)
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LogsTable({ qs }: { qs: string }) {
  const [page, setPage] = useState(1)
  const combinedQs = `${qs}&page=${page}&page_size=50`
  const { data, loading, error } = useAnalyticsSection<LogsResp>("/api/ops/ble-analytics/logs", combinedQs)
  useEffect(() => { setPage(1) }, [qs])
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-slate-100">로그</span>
        {data && (
          <span className="text-[10px] text-slate-500">
            {data.total}건 · {page} / {Math.max(1, Math.ceil(data.total / data.page_size))}
          </span>
        )}
      </div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
      {loading && !data && <Skeleton h={220} />}
      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 border-b border-white/[0.06]">
                  <th className="px-2 py-1 text-left">시각</th>
                  <th className="px-2 py-1 text-left">대상</th>
                  <th className="px-2 py-1 text-left">층/매장</th>
                  <th className="px-2 py-1 text-left">원래 위치</th>
                  <th className="px-2 py-1 text-left">수정/피드백</th>
                  <th className="px-2 py-1 text-left">사유</th>
                  <th className="px-2 py-1 text-left">기록자</th>
                  <th className="px-2 py-1 text-left">게이트웨이</th>
                  <th className="px-2 py-1 text-left">출처</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="border-b border-white/[0.03] align-top">
                    <td className="px-2 py-1 text-slate-400 font-mono">{new Date(r.at).toLocaleString("ko-KR")}</td>
                    <td className="px-2 py-1 text-slate-100">{r.membership?.display_name ?? "—"}</td>
                    <td className="px-2 py-1 text-slate-400">
                      {[r.floor_no ? `${r.floor_no}F` : null, r.store_name].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-1 text-slate-300">
                      {labelZone(r.original.zone)}{r.original.room_name ? ` · ${r.original.room_name}` : ""}
                    </td>
                    <td className="px-2 py-1">
                      {r.kind === "correction" && r.corrected
                        ? <span className="text-amber-300">→ {labelZone(r.corrected.zone)}{r.corrected.room_name ? ` · ${r.corrected.room_name}` : ""}</span>
                        : r.feedback_type === "positive"
                          ? <span className="text-emerald-300">👍 정확</span>
                          : <span className="text-red-300">👎 오탐</span>}
                    </td>
                    <td className="px-2 py-1 text-slate-400">{r.reason ?? "—"}</td>
                    <td className="px-2 py-1 text-slate-300">{r.actor?.display_name ?? "—"}</td>
                    <td className="px-2 py-1 text-slate-400 font-mono">{r.gateway_id ?? "—"}</td>
                    <td className="px-2 py-1 text-slate-500">{r.source ?? r.kind}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={9} className="px-2 py-8 text-center text-slate-500">로그 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2 py-1 rounded-md text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >이전</button>
            <button
              type="button"
              disabled={(data.total <= data.page * data.page_size) || loading}
              onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 rounded-md text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >다음</button>
          </div>
        </>
      )}
    </div>
  )
}

function Skeleton({ h }: { h: number }) {
  return <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] animate-pulse" style={{ height: h }} />
}

// ───────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────

export default function BleAnalyticsPage() {
  const [filters, setFilters] = useState<Filters>(() => (typeof window !== "undefined" ? parseFiltersFromUrl() : defaultFilters()))

  // Sync filters → URL so links are shareable and survive reloads.
  useEffect(() => {
    if (typeof window === "undefined") return
    const qs = filtersToQuery(filters)
    const next = `${window.location.pathname}?${qs}`
    window.history.replaceState(null, "", next)
  }, [filters])

  const qs = useMemo(() => filtersToQuery(filters), [filters])
  const overview = useAnalyticsSection<OverviewResp>("/api/ops/ble-analytics/overview", qs)

  const reset = () => setFilters(defaultFilters())

  return (
    <div className="min-h-screen bg-[#07091A] text-slate-200 flex flex-col">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0b0e1c]">
        <div className="flex items-center gap-3">
          <a href="/counter/monitor" className="text-[11px] text-slate-500 hover:text-slate-200 underline-offset-2 hover:underline">← 모니터</a>
          <span className="text-sm font-bold">BLE 분석</span>
          {overview.data?.scope.isSuperAdmin && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/40 text-cyan-200">
              super-admin
            </span>
          )}
          {overview.data?.saturated && (
            <span className="text-[10px] text-amber-300">데이터가 표시 한도에 도달했습니다.</span>
          )}
        </div>
        <div className="text-[10px] text-slate-500">
          범위 · {new Date(filters.from).toLocaleDateString("ko-KR")} ~ {new Date(filters.to).toLocaleDateString("ko-KR")}
        </div>
      </header>

      <FilterBar filters={filters} onChange={setFilters} onReset={reset} />

      <KpiRow data={overview.data} loading={overview.loading} error={overview.error} />
      <Recommendations data={overview.data} />

      <section className="grid gap-3 px-4 pb-3" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <TransitionMatrix
          filters={filters}
          qs={qs}
          onCellClick={(from, to) => setFilters({ ...filters, zone_from: from, zone_to: to })}
        />
        <GatewayTable qs={qs} />
      </section>

      <section className="px-4 pb-3">
        <FloorErrorMap qs={qs} />
      </section>

      <section className="px-4 pb-3">
        <Timeline qs={qs} />
      </section>

      <section className="px-4 pb-6">
        <LogsTable qs={qs} />
      </section>
    </div>
  )
}
