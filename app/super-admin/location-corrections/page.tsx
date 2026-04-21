"use client"

/**
 * /super-admin/location-corrections
 *
 * 운영자(super_admin) 전용 검수 로그 조회 화면.
 *
 * 섹션:
 *   ① 상단 요약 (overview API)
 *   ② 매장 비교 (overview.by_store)
 *   ③ 검수자 랭킹 (overview.by_reviewer) + 클릭 시 daily-summary/by-user 조회
 *   ④ 상세 로그 (by-user, keyset cursor)
 *
 * 추가: Phase 3 API 검증 패널
 *   - /api/monitor/scope 호출 (모든 scope)
 *   - /api/monitor/stores?floor=N 호출
 *   - /api/monitor/movement/[membership_id] 호출
 *   - 403 / 에러 / 빈 응답 실제 확인 가능
 *   - mock 데이터 없음. 진짜 API 만 호출.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type ErrorTypeKey =
  | "ROOM_MISMATCH" | "STORE_MISMATCH" | "HALLWAY_DRIFT" | "ELEVATOR_ZONE" | "MANUAL_INPUT_ERROR"

type Overview = {
  range: { start_date: string; end_date: string; today: string }
  totals: {
    total: number; today: number; reviewer_count: number
    by_error_type: Record<ErrorTypeKey, number>
  }
  by_store: Array<{ store_uuid: string | null; store_name: string; total: number; top_error_type: string }>
  by_floor: Array<{ floor: number | "unknown"; total: number }>
  by_reviewer: Array<{
    user_id: string; nickname: string; role: string
    store_uuid: string; store_name: string
    today_count: number; total_in_range: number
  }>
}

type ByUserItem = {
  id: string; corrected_at: string; error_type: string; correction_note: string | null
  target: { name: string; membership_id: string }
  detected: { store_name: string | null; room_no: string | null; zone: string | null; floor: number | null }
  corrected: { store_name: string | null; room_no: string | null; zone: string; floor: number | null }
  reviewer: { user_id: string; nickname: string; role: string; store_name: string }
}

type ByUserResp = {
  ok: true
  user: { id: string; nickname: string | null; full_name: string | null }
  range: { start_date: string; end_date: string }
  total: number
  items: ByUserItem[]
  next_cursor: string | null
}

type DailySummaryResp = {
  ok: true
  user: { id: string; nickname: string | null }
  range: { start_date: string; end_date: string }
  days: Array<{
    date: string; total: number
    by_error_type: Record<ErrorTypeKey, number>
  }>
}

const ERROR_LABEL: Record<ErrorTypeKey, string> = {
  ROOM_MISMATCH: "방 오탐",
  STORE_MISMATCH: "매장 오탐",
  HALLWAY_DRIFT: "복도 드리프트",
  ELEVATOR_ZONE: "엘리베이터",
  MANUAL_INPUT_ERROR: "수동 입력",
}

// ── Utilities ────────────────────────────────────────────────────
function todayKS(): string {
  const now = new Date()
  const ks = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return ks.toISOString().slice(0, 10)
}
function daysAgoKS(n: number): string {
  const end = Date.parse(todayKS() + "T00:00:00Z")
  return new Date(end - n * 86400000).toISOString().slice(0, 10)
}

// ════════════════════════════════════════════════════════════════
// Page component
// ════════════════════════════════════════════════════════════════

export default function SuperAdminLocationCorrectionsPage() {
  // ── Filters ──
  const [startDate, setStartDate] = useState(daysAgoKS(29))
  const [endDate, setEndDate] = useState(todayKS())

  // ── Overview ──
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true); setOverviewError(null)
    try {
      const r = await apiFetch(
        `/api/location/corrections/overview?start_date=${startDate}&end_date=${endDate}`,
      )
      if (r.status === 403) {
        setOverview(null)
        setOverviewError("403 — 이 페이지는 super_admin 전용입니다.")
        return
      }
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        setOverviewError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
        return
      }
      const json = await r.json() as Overview
      setOverview(json)
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : "network error")
    } finally {
      setOverviewLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => { void loadOverview() }, [loadOverview])

  // ── Reviewer drill-down ──
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [expandedDaily, setExpandedDaily] = useState<DailySummaryResp | null>(null)
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [expandedError, setExpandedError] = useState<string | null>(null)

  const loadDaily = useCallback(async (userId: string) => {
    setExpandedLoading(true); setExpandedError(null); setExpandedDaily(null)
    try {
      const r = await apiFetch(
        `/api/location/corrections/daily-summary?user_id=${userId}&start_date=${startDate}&end_date=${endDate}`,
      )
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        setExpandedError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
        return
      }
      setExpandedDaily(await r.json())
    } catch (e) {
      setExpandedError(e instanceof Error ? e.message : "network error")
    } finally {
      setExpandedLoading(false)
    }
  }, [startDate, endDate])

  const toggleExpand = (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null); setExpandedDaily(null); setExpandedError(null)
    } else {
      setExpandedUserId(userId); void loadDaily(userId)
    }
  }

  // ── Detail log (by-user) ──
  const [detailUserId, setDetailUserId] = useState("")
  const [detailNickname, setDetailNickname] = useState("")
  const [detailItems, setDetailItems] = useState<ByUserItem[]>([])
  const [detailCursor, setDetailCursor] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const loadDetail = useCallback(async (append = false) => {
    const id = detailUserId.trim()
    const name = detailNickname.trim()
    if (!id && !name) return
    setDetailLoading(true); setDetailError(null)
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: "100" })
      if (id) params.set("user_id", id)
      else if (name) params.set("nickname", name)
      if (append && detailCursor) params.set("cursor", detailCursor)
      const r = await apiFetch(`/api/location/corrections/by-user?${params.toString()}`)
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        setDetailError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
        if (!append) setDetailItems([])
        return
      }
      const json = await r.json() as ByUserResp
      setDetailItems(prev => append ? [...prev, ...json.items] : json.items)
      setDetailCursor(json.next_cursor)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "network error")
    } finally {
      setDetailLoading(false)
    }
  }, [detailUserId, detailNickname, detailCursor, startDate, endDate])

  // ══════════════════════════════════════════════════════════════
  // Phase 3 diagnostic panel
  // ══════════════════════════════════════════════════════════════

  const [p3Scope, setP3Scope] = useState("mine")
  const [p3Res, setP3Res] = useState<unknown>(null)
  const [p3Loading, setP3Loading] = useState(false)
  const [p3Err, setP3Err] = useState<string | null>(null)

  const [storesFloor, setStoresFloor] = useState("5")
  const [storesRes, setStoresRes] = useState<unknown>(null)
  const [storesErr, setStoresErr] = useState<string | null>(null)

  const [mvMemId, setMvMemId] = useState("")
  const [mvRes, setMvRes] = useState<unknown>(null)
  const [mvErr, setMvErr] = useState<string | null>(null)

  const callScope = async () => {
    setP3Loading(true); setP3Err(null); setP3Res(null)
    try {
      const r = await apiFetch(`/api/monitor/scope?scope=${encodeURIComponent(p3Scope)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setP3Err(`${r.status} — ${(j as { message?: string }).message ?? "err"}`)
      setP3Res(j)
    } finally { setP3Loading(false) }
  }
  const callStores = async () => {
    setStoresErr(null); setStoresRes(null)
    const r = await apiFetch(`/api/monitor/stores?floor=${encodeURIComponent(storesFloor)}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setStoresErr(`${r.status} — ${(j as { message?: string }).message ?? "err"}`)
    setStoresRes(j)
  }
  const callMovement = async () => {
    setMvErr(null); setMvRes(null)
    const r = await apiFetch(`/api/monitor/movement/${encodeURIComponent(mvMemId.trim())}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setMvErr(`${r.status} — ${(j as { message?: string }).message ?? "err"}`)
    setMvRes(j)
  }

  const p3Summary = useMemo(() => {
    if (!p3Res || typeof p3Res !== "object") return null
    const r = p3Res as {
      scope?: string; mode?: string; generated_at?: string
      stores?: unknown[]; home_workers?: unknown[]
      foreign_workers_at_mine?: unknown[]; movement?: unknown[]
      meta?: { isCrossStore?: boolean; floor?: number | null; isSuper?: boolean }
    }
    return {
      scope: r.scope, mode: r.mode, generated_at: r.generated_at,
      stores_count: (r.stores ?? []).length,
      home_workers_count: (r.home_workers ?? []).length,
      foreign_workers_count: (r.foreign_workers_at_mine ?? []).length,
      movement_count: (r.movement ?? []).length,
      meta: r.meta,
    }
  }, [p3Res])

  // ══════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[#07091A] text-slate-200 p-4 text-[13px]">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex items-center gap-3">
          <Link href="/super-admin" className="text-slate-500 hover:text-slate-200">← 대시보드</Link>
          <h1 className="text-base font-bold tracking-tight">위치 검수 로그</h1>
          <span className="text-[10px] text-slate-500">super_admin 전용</span>
        </header>

        {/* ── Filters ── */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            시작 날짜
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-slate-100" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            종료 날짜
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-slate-100" />
          </label>
          <button onClick={() => void loadOverview()}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 font-semibold">
            조회
          </button>
        </section>

        {/* ── ① 상단 요약 ── */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-slate-300 mb-2">① 상단 요약</h2>
          {overviewLoading && <div className="text-slate-500 text-[11px]">loading…</div>}
          {overviewError && <div className="text-red-300 text-[11px]">⚠ {overviewError}</div>}
          {!overviewLoading && !overviewError && !overview && (
            <div className="text-slate-500 text-[11px]">데이터 없음.</div>
          )}
          {overview && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="전체" value={overview.totals.total} />
              <Stat label="오늘" value={overview.totals.today} />
              <Stat label="검수자 수" value={overview.totals.reviewer_count} />
              <Stat label="ROOM_MISMATCH" value={overview.totals.by_error_type.ROOM_MISMATCH} />
              <Stat label="STORE_MISMATCH" value={overview.totals.by_error_type.STORE_MISMATCH} />
              <Stat label="HALLWAY_DRIFT" value={overview.totals.by_error_type.HALLWAY_DRIFT} />
              <Stat label="ELEVATOR_ZONE" value={overview.totals.by_error_type.ELEVATOR_ZONE} />
              <Stat label="MANUAL_INPUT_ERROR" value={overview.totals.by_error_type.MANUAL_INPUT_ERROR} />
            </div>
          )}
        </section>

        {/* ── ② 매장 비교 ── */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-slate-300 mb-2">② 매장 비교 (오류 발생 기준)</h2>
          {!overview || overview.by_store.length === 0
            ? <div className="text-slate-500 text-[11px]">데이터 없음.</div>
            : (
              <table className="w-full text-[11px]">
                <thead><tr className="text-slate-500">
                  <th className="text-left py-1">매장</th>
                  <th className="text-right">건수</th>
                  <th className="text-left pl-4">주요 유형</th>
                </tr></thead>
                <tbody>
                  {overview.by_store.map((s, i) => (
                    <tr key={s.store_uuid ?? `unknown-${i}`} className="border-t border-white/[0.06]">
                      <td className="py-1 text-slate-200">{s.store_name}</td>
                      <td className="text-right tabular-nums">{s.total}</td>
                      <td className="pl-4 text-slate-400">{s.top_error_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </section>

        {/* ── ③ 검수자 랭킹 ── */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-slate-300 mb-2">③ 검수자 랭킹</h2>
          {!overview || overview.by_reviewer.length === 0
            ? <div className="text-slate-500 text-[11px]">데이터 없음.</div>
            : (
              <div className="space-y-1">
                {overview.by_reviewer.map(r => (
                  <div key={r.user_id} className="border border-white/[0.06] rounded-md">
                    <button onClick={() => toggleExpand(r.user_id)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03]">
                      <span className="text-slate-200 font-semibold">{r.nickname}</span>
                      <span className="text-[10px] text-slate-500">{r.role}/{r.store_name}</span>
                      <span className="ml-auto text-[11px] text-slate-400">오늘 <b className="text-cyan-300">{r.today_count}</b></span>
                      <span className="text-[11px] text-slate-400">기간 <b className="text-slate-200">{r.total_in_range}</b></span>
                      <span className="text-slate-500">{expandedUserId === r.user_id ? "▴" : "▾"}</span>
                    </button>
                    {expandedUserId === r.user_id && (
                      <div className="px-3 pb-2">
                        {expandedLoading && <div className="text-slate-500 text-[11px]">loading…</div>}
                        {expandedError && <div className="text-red-300 text-[11px]">⚠ {expandedError}</div>}
                        {expandedDaily && (
                          <div className="space-y-1 mt-2">
                            {expandedDaily.days.length === 0 && <div className="text-slate-500 text-[11px]">기간 내 활동 없음</div>}
                            {expandedDaily.days.map(d => (
                              <div key={d.date} className="flex items-center gap-2 text-[11px]">
                                <span className="text-slate-300 w-24">{d.date}</span>
                                <span className="text-cyan-300 w-12 text-right">총 {d.total}</span>
                                {(Object.keys(d.by_error_type) as ErrorTypeKey[]).map(k =>
                                  d.by_error_type[k] > 0
                                    ? <span key={k} className="text-slate-400">{ERROR_LABEL[k]} <b className="text-slate-200">{d.by_error_type[k]}</b></span>
                                    : null
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-2">
                          <button onClick={() => { setDetailUserId(r.user_id); setDetailNickname(""); setDetailCursor(null); void loadDetail(false) }}
                            className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white">
                            ↓ 이 유저 상세 로그 보기
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </section>

        {/* ── ④ 상세 로그 ── */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-slate-300 mb-2">④ 상세 로그 (by-user)</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <input placeholder="user_id (uuid)" value={detailUserId}
              onChange={e => setDetailUserId(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100 min-w-[280px]" />
            <input placeholder="또는 nickname" value={detailNickname}
              onChange={e => setDetailNickname(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100" />
            <button onClick={() => { setDetailCursor(null); void loadDetail(false) }}
              className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[11px] font-semibold">
              조회
            </button>
          </div>
          {detailLoading && <div className="text-slate-500 text-[11px]">loading…</div>}
          {detailError && <div className="text-red-300 text-[11px]">⚠ {detailError}</div>}
          {!detailLoading && !detailError && detailItems.length === 0 && (
            <div className="text-slate-500 text-[11px]">기록 없음 (또는 권한 범위 밖).</div>
          )}
          {detailItems.length > 0 && (
            <>
              <table className="w-full text-[11px]">
                <thead><tr className="text-slate-500">
                  <th className="text-left py-1">시간</th>
                  <th className="text-left">검수자</th>
                  <th className="text-left">대상</th>
                  <th className="text-left">기존 → 수정</th>
                  <th className="text-left">유형</th>
                  <th className="text-left">메모</th>
                </tr></thead>
                <tbody>
                  {detailItems.map(it => (
                    <tr key={it.id} className="border-t border-white/[0.06] align-top">
                      <td className="py-1 text-slate-300 tabular-nums">{it.corrected_at.replace("T", " ").slice(0, 19)}</td>
                      <td className="text-slate-300">{it.reviewer.nickname}<span className="text-slate-500 text-[10px]"> ({it.reviewer.store_name})</span></td>
                      <td className="text-slate-200">{it.target.name}</td>
                      <td className="text-slate-400">
                        <span>{it.detected.store_name ?? "?"}/{it.detected.room_no ?? it.detected.zone ?? "?"}</span>
                        <span className="mx-1 text-slate-500">→</span>
                        <span>{it.corrected.store_name ?? "?"}/{it.corrected.room_no ?? it.corrected.zone}</span>
                      </td>
                      <td className="text-amber-200">{it.error_type}</td>
                      <td className="text-slate-500 max-w-[260px] truncate" title={it.correction_note ?? ""}>{it.correction_note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailCursor && (
                <div className="mt-2">
                  <button onClick={() => void loadDetail(true)} disabled={detailLoading}
                    className="text-[11px] px-3 py-1 rounded bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white disabled:opacity-50">
                    더 불러오기
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Phase 3 API 검증 패널 ── */}
        <section className="rounded-xl border border-cyan-500/20 bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-cyan-200 mb-2">Phase 3 API 실데이터 검증</h2>
          <div className="text-[10px] text-slate-500 mb-3">mock 아님. 실제 엔드포인트 호출 결과. 403 / 에러 / 빈 응답 모두 그대로 표시.</div>

          {/* Scope */}
          <div className="border border-white/[0.06] rounded-md p-3 mb-2">
            <div className="text-[11px] font-semibold text-slate-300 mb-1">GET /api/monitor/scope</div>
            <div className="flex gap-2 items-center">
              <select value={p3Scope} onChange={e => setP3Scope(e.target.value)}
                className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100">
                <option value="mine">mine</option>
                <option value="current_floor">current_floor</option>
                <option value="floor-5">floor-5</option>
                <option value="floor-6">floor-6</option>
                <option value="floor-7">floor-7</option>
                <option value="floor-8">floor-8</option>
              </select>
              <button onClick={() => void callScope()} disabled={p3Loading}
                className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[11px] disabled:opacity-50">
                호출
              </button>
            </div>
            {p3Err && <div className="mt-1 text-red-300 text-[11px]">⚠ {p3Err}</div>}
            {p3Summary && (
              <div className="mt-2 text-[11px] text-slate-300 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">
                <span>scope: <b>{p3Summary.scope}</b></span>
                <span>mode: <b>{p3Summary.mode}</b></span>
                <span>stores: <b className="text-cyan-300">{p3Summary.stores_count}</b></span>
                <span>home_workers: <b className="text-cyan-300">{p3Summary.home_workers_count}</b></span>
                <span>foreign@mine: <b className="text-cyan-300">{p3Summary.foreign_workers_count}</b></span>
                <span>movement: <b className="text-cyan-300">{p3Summary.movement_count}</b></span>
                {p3Summary.meta && (<>
                  <span>isCrossStore: <b>{String(p3Summary.meta.isCrossStore)}</b></span>
                  <span>floor: <b>{String(p3Summary.meta.floor)}</b></span>
                </>)}
              </div>
            )}
          </div>

          {/* Stores */}
          <div className="border border-white/[0.06] rounded-md p-3 mb-2">
            <div className="text-[11px] font-semibold text-slate-300 mb-1">GET /api/monitor/stores?floor=N</div>
            <div className="flex gap-2 items-center">
              <select value={storesFloor} onChange={e => setStoresFloor(e.target.value)}
                className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100">
                {["5","6","7","8"].map(f => <option key={f} value={f}>{f}F</option>)}
              </select>
              <button onClick={() => void callStores()}
                className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[11px]">
                호출
              </button>
            </div>
            {storesErr && <div className="mt-1 text-red-300 text-[11px]">⚠ {storesErr}</div>}
            {storesRes != null && (
              <pre className="mt-2 text-[10px] text-slate-400 max-h-40 overflow-auto">{JSON.stringify(storesRes, null, 2)}</pre>
            )}
          </div>

          {/* Movement */}
          <div className="border border-white/[0.06] rounded-md p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-1">GET /api/monitor/movement/[membership_id]</div>
            <div className="flex gap-2 items-center">
              <input value={mvMemId} onChange={e => setMvMemId(e.target.value)}
                placeholder="membership_id (uuid)"
                className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100 min-w-[280px]" />
              <button onClick={() => void callMovement()} disabled={!mvMemId.trim()}
                className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[11px] disabled:opacity-50">
                호출
              </button>
            </div>
            {mvErr && <div className="mt-1 text-red-300 text-[11px]">⚠ {mvErr}</div>}
            {mvRes != null && (
              <pre className="mt-2 text-[10px] text-slate-400 max-h-40 overflow-auto">{JSON.stringify(mvRes, null, 2)}</pre>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white/[0.03] border border-white/[0.06] px-3 py-2">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-base font-bold tabular-nums text-slate-100">{value}</div>
    </div>
  )
}
