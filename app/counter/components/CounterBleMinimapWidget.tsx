"use client"

/**
 * CounterBleMinimapWidget — compact, scope-selectable operational BLE
 * widget for /counter.
 *
 * Replaces the former full-page MonitorPanel embed. This widget is
 * intentionally minimalist — it prioritises operational clarity (room
 * counts, restroom / elevator / absence aggregates, a slim grid) over
 * the analytics-style full-page experience.
 *
 * Scope model
 * -----------
 * `scope` picks the visible subset:
 *   own_store       — caller's store only. Default. Always available.
 *   current_floor   — all rooms on the caller's store floor. Identical
 *                     to own_store today because GET /api/counter/monitor
 *                     is single-store, but kept as a distinct option so
 *                     a future cross-store endpoint can expand it
 *                     without rewriting this component.
 *   5F / 6F / 7F / 8F — specific floor. If the selected floor equals
 *                     the caller's store floor, data is real; otherwise
 *                     the widget shows an explicit "cross-store data
 *                     not yet wired" placeholder instead of empty or
 *                     misleading UI. No fake data, no silent fallback.
 *
 * Permission gating
 * -----------------
 * Role → allowed scopes:
 *   owner   : own_store, current_floor, 5F, 6F, 7F, 8F
 *   manager : own_store, current_floor, 5F, 6F, 7F, 8F
 *   other   : own_store, current_floor
 *
 * If the persisted scope is not in the allowed list for the current
 * role, the widget silently falls back to `own_store`.
 *
 * Visibility filters (applied client-side on top of server filtering)
 * ------------------------------------------------------------------
 *   1. Rooms:        keep all rooms the API returned; API has already
 *                    scoped by store_uuid + deleted_at + active session.
 *   2. Scope filter: if a specific floor is selected, drop rooms whose
 *                    `floor_no` does not match.
 *   3. Participants: include only `status in ("active","mid_out")` AND
 *                    `operator_status !== "ended"`. This double-gates
 *                    the server filter so any in-flight checkout row
 *                    that slipped past the API cut is still hidden.
 *                    Checked-out / inactive / deleted participants are
 *                    therefore never rendered.
 *   4. Foreign rooms (scope 5F/6F/7F/8F ≠ own floor): data is not
 *                    available from /api/counter/monitor — the widget
 *                    shows an explicit placeholder rather than
 *                    pretending.
 *
 * Count rules
 * -----------
 *   room cell "A/B" :
 *       B = visible participants assigned to that room (active + mid_out)
 *       A = B - mid_out = in-room count right now
 *     e.g. Marvel room 1 with 3 assigned, 1 in restroom → "2/3" and a
 *     small "· 화장실 1" hint appears on the cell.
 *   restroom total  = Σ rooms.participants where mid_out (participant-
 *                     derived) ∪ BLE presence rows with zone=restroom
 *                     that aren't already represented by a mid_out
 *                     participant.
 *   elevator total  = BLE presence rows with zone=elevator.
 *   외부(타층)       = summary.external_floor (server aggregate).
 *   대기            = summary.waiting          (server aggregate).
 *
 * Collapse state and scope are persisted to localStorage under
 * `nox.counter.ble_minimap.*`. If localStorage is unavailable the
 * widget falls back to local state for the current tab.
 */

import { useEffect, useMemo, useState } from "react"
import { useScopedMonitor, type MonitorScope } from "../monitor/hooks/useMonitorData"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import type { MonitorRoom, MonitorRoomParticipant } from "../monitor/types"

// ────────────────────────────────────────────────────────────────
// Scope model + role policy
// ────────────────────────────────────────────────────────────────

export type BleMinimapScope =
  | "own_store"
  | "current_floor"
  | "5F"
  | "6F"
  | "7F"
  | "8F"

const SCOPE_ORDER: BleMinimapScope[] = ["own_store", "current_floor", "5F", "6F", "7F", "8F"]

const SCOPE_LABEL: Record<BleMinimapScope, string> = {
  own_store:     "내 가게",
  current_floor: "현재 층",
  "5F": "5F",
  "6F": "6F",
  "7F": "7F",
  "8F": "8F",
}

const SCOPE_FLOOR: Partial<Record<BleMinimapScope, number>> = {
  "5F": 5,
  "6F": 6,
  "7F": 7,
  "8F": 8,
}

function allowedScopesFor(role: string | null): BleMinimapScope[] {
  if (role === "owner" || role === "manager") return SCOPE_ORDER.slice()
  // All other roles (waiter, staff, hostess, unknown) get own-store only
  // options. The selector still renders; non-allowed items simply do
  // not appear.
  return ["own_store", "current_floor"]
}

// ────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────

const KEY_COLLAPSED = "nox.counter.ble_minimap.collapsed"
const KEY_SCOPE     = "nox.counter.ble_minimap.scope"

function readStorage(key: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null }
  catch { return null }
}
function writeStorage(key: string, value: string) {
  try { if (typeof window !== "undefined") window.localStorage.setItem(key, value) }
  catch { /* noop — private mode / full storage */ }
}

// ────────────────────────────────────────────────────────────────
// Visibility helpers
// ────────────────────────────────────────────────────────────────

/**
 * Client-side participant visibility gate. The server already filters
 * checked-out / inactive / deleted rows, but this is a belt-and-braces
 * check: any row whose status is not one of the two operational
 * statuses, or whose operator_status says the row has been ended,
 * must not appear.
 */
function visibleParticipant(p: MonitorRoomParticipant): boolean {
  if (p.status !== "active" && p.status !== "mid_out") return false
  if (p.operator_status === "ended") return false
  return true
}

/**
 * Derive the caller's store floor by mode of room.floor_no. Majority
 * vote handles the rare case of cross-floor stores cleanly.
 */
function deriveOwnFloor(rooms: MonitorRoom[]): number | null {
  const tally = new Map<number, number>()
  for (const r of rooms) if (r.floor_no != null) tally.set(r.floor_no, (tally.get(r.floor_no) ?? 0) + 1)
  let best: number | null = null, max = 0
  for (const [k, v] of tally) if (v > max) { max = v; best = k }
  return best
}

// ────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────

// Widget scope → API scope mapping.
//   own_store     → mine                (legacy endpoint, zero regression)
//   current_floor → current_floor       (new API)
//   5F..8F        → floor-5..floor-8    (new API; super_admin gets multi-store)
function toApiScope(s: BleMinimapScope): MonitorScope {
  switch (s) {
    case "own_store":     return "mine"
    case "current_floor": return "current_floor"
    case "5F":            return "floor-5"
    case "6F":            return "floor-6"
    case "7F":            return "floor-7"
    case "8F":            return "floor-8"
  }
}

export default function CounterBleMinimapWidget() {
  const profile = useCurrentProfile()
  const role = profile?.role ?? null

  const allowed = useMemo(() => allowedScopesFor(role), [role])

  // Persisted collapse + scope. Initial render uses safe defaults so
  // SSR and first client render match; localStorage hydration happens
  // in an effect.
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [scope, setScopeState] = useState<BleMinimapScope>("own_store")
  useEffect(() => {
    const c = readStorage(KEY_COLLAPSED)
    if (c === "1") setCollapsed(true)
    const s = readStorage(KEY_SCOPE) as BleMinimapScope | null
    if (s && SCOPE_ORDER.includes(s)) setScopeState(s)
  }, [])
  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v); writeStorage(KEY_COLLAPSED, v ? "1" : "0")
  }
  const setScopePersist = (s: BleMinimapScope) => {
    setScopeState(s); writeStorage(KEY_SCOPE, s)
  }
  // Guard against a persisted scope the current role is not allowed to see.
  const effectiveScope: BleMinimapScope = allowed.includes(scope) ? scope : "own_store"

  // Phase 3: scope-aware data fetch. 'own_store' → /api/counter/monitor
  // (legacy, regression-free). 그 외 scope → /api/monitor/scope.
  const { data, loading, error, lastUpdatedAt, refresh } = useScopedMonitor(
    toApiScope(effectiveScope),
  )

  const ownFloor = useMemo(() => deriveOwnFloor(data?.rooms ?? []), [data])

  // Resolve the floor filter the current scope should apply.
  const selectedFloor: number | null =
    effectiveScope === "own_store" ? null :
    effectiveScope === "current_floor" ? ownFloor :
    SCOPE_FLOOR[effectiveScope] ?? null

  // Phase 3: server returns scope-correct rooms via /api/monitor/scope.
  // Client-side floor filter is a safety net (identity passthrough when
  // server already filtered).
  const rooms: MonitorRoom[] = useMemo(() => {
    const src = data?.rooms ?? []
    if (selectedFloor == null) return src
    return src.filter((r) => r.floor_no === selectedFloor)
  }, [data, selectedFloor])

  // Per-room cell computation.
  const cells = useMemo(() => {
    return rooms.map((r) => {
      let active = 0, mid = 0
      for (const p of r.participants) {
        if (!visibleParticipant(p)) continue
        if (p.status === "active" && p.zone === "room") active++
        if (p.status === "mid_out" || p.zone === "mid_out") mid++
      }
      return { room: r, active, mid, total: active + mid }
    })
  }, [rooms])

  // Aggregate operational counts.
  const ops = useMemo(() => {
    let inRoom = 0, midOut = 0
    for (const c of cells) { inRoom += c.active; midOut += c.mid }
    const ble = data?.ble.presence ?? []
    let bleRestroom = 0, bleElevator = 0
    for (const b of ble) {
      if (b.zone === "restroom") bleRestroom++
      else if (b.zone === "elevator") bleElevator++
    }
    return {
      inRoom,
      midOut,
      // Restroom surface count: trust participant mid_out as the
      // operational truth, fall back to BLE reading only when it
      // reports MORE than the participant-derived count (e.g.,
      // waiting hostesses who are not yet participants).
      restroom: Math.max(midOut, bleRestroom),
      elevator: bleElevator,
      waiting: data?.summary.waiting ?? 0,
      external: data?.summary.external_floor ?? 0,
    }
  }, [cells, data])

  const lastLabel = useMemo(() => {
    if (!lastUpdatedAt) return loading ? "동기화 중…" : "—"
    const t = new Date(lastUpdatedAt)
    const hh = String(t.getHours()).padStart(2, "0")
    const mm = String(t.getMinutes()).padStart(2, "0")
    const ss = String(t.getSeconds()).padStart(2, "0")
    return `${hh}:${mm}:${ss}`
  }, [lastUpdatedAt, loading])

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────

  return (
    <section
      className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] text-slate-200"
      aria-label="BLE 미니맵"
    >
      {/* Slim header — always visible, clickable to toggle collapse. */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <span className="text-[11px] font-bold tracking-tight">BLE 미니맵</span>
        {/* Realtime indicator */}
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            error ? "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.9)]"
                  : loading ? "bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.9)] animate-pulse"
                  : "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.9)]"
          }`}
          title={error ? "오류" : loading ? "동기화 중" : "실시간"}
          aria-hidden
        />
        {/* Inline summary chips — always render so collapsed header is
            still operationally useful. */}
        <span className="text-[10px] text-slate-400 flex items-center gap-2 ml-1">
          <span>재실 <b className="text-cyan-300">{ops.inRoom}</b></span>
          <span className="text-slate-600">·</span>
          <span>이탈 <b className="text-amber-300">{ops.midOut}</b></span>
          <span className="text-slate-600">·</span>
          <span>대기 <b className="text-slate-200">{ops.waiting}</b></span>
        </span>

        <span className="ml-auto flex items-center gap-2">
          {/* Scope selector */}
          <select
            value={effectiveScope}
            onChange={(e) => setScopePersist(e.target.value as BleMinimapScope)}
            className="text-[10px] font-semibold bg-white/[0.05] border border-white/10 rounded px-1.5 py-0.5 text-slate-200"
            title="보기 범위"
          >
            {SCOPE_ORDER.filter((s) => allowed.includes(s)).map((s) => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 tabular-nums" title="최근 업데이트">{lastLabel}</span>
          <button
            onClick={() => { void refresh() }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 text-slate-400 hover:text-slate-200"
            title="새로고침"
          >
            ⟳
          </button>
          <button
            onClick={() => setCollapsedPersist(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "펼치기" : "접기"}
            className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 text-slate-400 hover:text-slate-200"
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </span>
      </header>

      {/* Expanded body. */}
      {!collapsed && (
        <div className="px-3 py-2.5 flex flex-col gap-2.5">
          {/* Operational summary pills — restroom / elevator / 외부 */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <Pill label="화장실" value={ops.restroom} tone="amber" />
            <Pill label="엘리베이터" value={ops.elevator} tone="violet" />
            <Pill label="외부(타층)" value={ops.external} tone="slate" />
            <Pill label="대기" value={ops.waiting} tone="slate" />
            <Pill label="재실" value={ops.inRoom} tone="cyan" />
            <Pill label="이탈" value={ops.midOut} tone="amber" />
          </div>

          {/* Phase 3: Cross-store placeholder 제거. 서버가 /api/monitor/scope 로
              실제 범위 데이터를 반환하며, 권한이 없는 범위는 서버가 403 → 아래
              error 블록이 표시된다. */}

          {/* Minimap room grid. */}
          {(
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))" }}>
              {cells.length === 0 && (
                <div className="col-span-full text-[11px] text-slate-500 py-4 text-center">
                  표시할 방이 없습니다.
                </div>
              )}
              {cells.map(({ room, active, mid, total }) => {
                const occupied = total > 0
                const hasMidOut = mid > 0
                return (
                  <div
                    key={room.room_uuid}
                    className={`rounded-md border px-2 py-1.5 leading-tight ${
                      occupied
                        ? hasMidOut
                          ? "bg-amber-500/[0.08] border-amber-500/25"
                          : "bg-cyan-500/[0.08] border-cyan-500/25"
                        : "bg-white/[0.02] border-white/[0.06]"
                    }`}
                    title={`${room.room_name} · 재실 ${active}, 이탈 ${mid}, 총 ${total}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold truncate text-slate-200">
                        {room.room_name}
                      </span>
                      <span className="text-[9px] text-slate-500 tabular-nums">
                        {room.floor_no != null ? `${room.floor_no}F` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className={`text-[11px] font-bold tabular-nums ${
                          occupied ? (hasMidOut ? "text-amber-300" : "text-cyan-300") : "text-slate-500"
                        }`}
                      >
                        {active}/{total}
                      </span>
                      {hasMidOut && (
                        <span className="text-[9px] text-amber-300/80">· 화장실 {mid}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────
// Small local component
// ────────────────────────────────────────────────────────────────

function Pill({ label, value, tone }: { label: string; value: number; tone: "cyan" | "amber" | "violet" | "slate" }) {
  const toneCls =
    tone === "cyan"   ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-200" :
    tone === "amber"  ? "bg-amber-500/10 border-amber-500/25 text-amber-200" :
    tone === "violet" ? "bg-violet-500/10 border-violet-500/25 text-violet-200" :
                        "bg-white/[0.04] border-white/10 text-slate-300"
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${toneCls}`}>
      <span className="opacity-70">{label}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  )
}
