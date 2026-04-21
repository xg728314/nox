"use client"

/**
 * /admin/location-corrections
 *
 * owner/manager 자기 매장 전용 검수 로그 조회.
 *
 * super-admin 페이지 대비 차이점:
 *   - overview API 호출 없음 (권한 없음 → 서버가 403)
 *   - 매장 비교 섹션 없음
 *   - 이메일 마스킹 적용
 *   - Phase 3 진단 패널 없음 (super_admin 전용)
 *
 * middleware 매트릭스:
 *   /admin/location-corrections 는 OWNER_MANAGER_PREFIXES 에 등록되어야
 *   manager 진입 가능. middleware.ts 수정 참조.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type ErrorTypeKey =
  | "ROOM_MISMATCH" | "STORE_MISMATCH" | "HALLWAY_DRIFT" | "ELEVATOR_ZONE" | "MANUAL_INPUT_ERROR"

type ByUserItem = {
  id: string; corrected_at: string; error_type: string; correction_note: string | null
  target: { name: string; membership_id: string }
  detected: { store_name: string | null; room_no: string | null; zone: string | null; floor: number | null }
  corrected: { store_name: string | null; room_no: string | null; zone: string; floor: number | null }
  reviewer: { user_id: string; nickname: string; role: string; store_name: string; email: string }
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

function todayKS(): string {
  const now = new Date()
  const ks = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return ks.toISOString().slice(0, 10)
}
function daysAgoKS(n: number): string {
  const end = Date.parse(todayKS() + "T00:00:00Z")
  return new Date(end - n * 86400000).toISOString().slice(0, 10)
}

/** 이메일 마스킹: `ab***@domain.com` */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!local || !domain) return "***"
  if (local.length <= 2) return `${local}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

export default function AdminLocationCorrectionsPage() {
  // Filters
  const [startDate, setStartDate] = useState(daysAgoKS(29))
  const [endDate, setEndDate] = useState(todayKS())
  const [userId, setUserId] = useState("")
  const [nickname, setNickname] = useState("")

  // by-user
  const [items, setItems] = useState<ByUserItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadByUser = useCallback(async (append = false) => {
    const id = userId.trim()
    const nm = nickname.trim()
    if (!id && !nm) return
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: "100" })
      if (id) params.set("user_id", id)
      else if (nm) params.set("nickname", nm)
      if (append && cursor) params.set("cursor", cursor)
      const r = await apiFetch(`/api/location/corrections/by-user?${params.toString()}`)
      if (r.status === 403) {
        setItems([]); setCursor(null)
        setError("403 — 이 기능에 접근할 권한이 없습니다 (owner/manager 만 가능).")
        return
      }
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        setError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
        if (!append) { setItems([]); setCursor(null) }
        return
      }
      const json = await r.json() as ByUserResp
      setItems(prev => append ? [...prev, ...json.items] : json.items)
      setCursor(json.next_cursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error")
    } finally {
      setLoading(false)
    }
  }, [userId, nickname, startDate, endDate, cursor])

  // daily drill
  const [dailyOpen, setDailyOpen] = useState(false)
  const [daily, setDaily] = useState<DailySummaryResp | null>(null)
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailyError, setDailyError] = useState<string | null>(null)

  const loadDaily = useCallback(async () => {
    const id = userId.trim() || (items[0]?.reviewer.user_id ?? "")
    if (!id) return
    setDailyLoading(true); setDailyError(null)
    try {
      const r = await apiFetch(
        `/api/location/corrections/daily-summary?user_id=${id}&start_date=${startDate}&end_date=${endDate}`,
      )
      if (r.status === 403) {
        setDaily(null)
        setDailyError("403 — 권한 범위 밖")
        return
      }
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        setDailyError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
        return
      }
      setDaily(await r.json())
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : "network error")
    } finally {
      setDailyLoading(false)
    }
  }, [userId, items, startDate, endDate])

  useEffect(() => {
    if (dailyOpen) void loadDaily()
  }, [dailyOpen, loadDaily])

  return (
    <div className="min-h-screen bg-[#07091A] text-slate-200 p-4 text-[13px]">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-center gap-3">
          <Link href="/owner" className="text-slate-500 hover:text-slate-200">← 매장</Link>
          <h1 className="text-base font-bold tracking-tight">위치 검수 로그</h1>
          <span className="text-[10px] text-slate-500">자기 매장 범위</span>
        </header>

        {/* 안내 배너 */}
        <div className="text-[10px] text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2">
          이 화면은 현재 매장에서 발생한 검수 활동만 보여 줍니다.
          다른 매장 / 전체 집계는 <b>super_admin</b> 전용 화면에서 조회 가능합니다.
        </div>

        {/* Filters */}
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
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            검수자 user_id
            <input value={userId} onChange={e => setUserId(e.target.value)}
              placeholder="uuid"
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100 min-w-[280px]" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            또는 nickname
            <input value={nickname} onChange={e => setNickname(e.target.value)}
              placeholder="ao11"
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-100" />
          </label>
          <button onClick={() => { setCursor(null); void loadByUser(false) }}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 font-semibold">
            조회
          </button>
          <button onClick={() => setDailyOpen(o => !o)}
            disabled={!userId.trim() && items.length === 0}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white disabled:opacity-40">
            {dailyOpen ? "일자별 요약 닫기" : "일자별 요약 보기"}
          </button>
        </section>

        {/* Daily summary drill */}
        {dailyOpen && (
          <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
            <h2 className="text-[12px] font-bold text-slate-300 mb-2">일자별 요약</h2>
            {dailyLoading && <div className="text-slate-500 text-[11px]">loading…</div>}
            {dailyError && <div className="text-red-300 text-[11px]">⚠ {dailyError}</div>}
            {daily && daily.days.length === 0 && <div className="text-slate-500 text-[11px]">기간 내 활동 없음.</div>}
            {daily && daily.days.length > 0 && (
              <table className="w-full text-[11px]">
                <thead><tr className="text-slate-500">
                  <th className="text-left py-1">날짜</th>
                  <th className="text-right">전체</th>
                  {(Object.keys(ERROR_LABEL) as ErrorTypeKey[]).map(k => (
                    <th key={k} className="text-right pl-3">{ERROR_LABEL[k]}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {daily.days.map(d => (
                    <tr key={d.date} className="border-t border-white/[0.06]">
                      <td className="py-1 text-slate-200">{d.date}</td>
                      <td className="text-right text-cyan-300 font-bold tabular-nums">{d.total}</td>
                      {(Object.keys(ERROR_LABEL) as ErrorTypeKey[]).map(k => (
                        <td key={k} className="text-right pl-3 tabular-nums text-slate-300">{d.by_error_type[k]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* by-user 상세 */}
        <section className="rounded-xl border border-white/[0.07] bg-[#0b0e1c] p-4">
          <h2 className="text-[12px] font-bold text-slate-300 mb-2">상세 로그</h2>
          {loading && <div className="text-slate-500 text-[11px]">loading…</div>}
          {error && <div className="text-red-300 text-[11px]">⚠ {error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="text-slate-500 text-[11px]">
              검수자 user_id / nickname 을 입력하고 조회하세요. 결과가 비어 있으면 해당 유저가 내 매장에서 기록한
              활동이 없거나 권한 범위 밖입니다.
            </div>
          )}
          {items.length > 0 && (
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
                  {items.map(it => (
                    <tr key={it.id} className="border-t border-white/[0.06] align-top">
                      <td className="py-1 text-slate-300 tabular-nums">{it.corrected_at.replace("T", " ").slice(0, 19)}</td>
                      <td className="text-slate-300">
                        <div>{it.reviewer.nickname}</div>
                        <div className="text-[9px] text-slate-500">{maskEmail(it.reviewer.email)}</div>
                      </td>
                      <td className="text-slate-200">{it.target.name}</td>
                      <td className="text-slate-400">
                        <span>{it.detected.store_name ?? "?"}/{it.detected.room_no ?? it.detected.zone ?? "?"}</span>
                        <span className="mx-1 text-slate-500">→</span>
                        <span>{it.corrected.store_name ?? "?"}/{it.corrected.room_no ?? it.corrected.zone}</span>
                      </td>
                      <td className="text-amber-200">{it.error_type}</td>
                      <td className="text-slate-500 max-w-[220px] truncate" title={it.correction_note ?? ""}>{it.correction_note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cursor && (
                <div className="mt-2">
                  <button onClick={() => void loadByUser(true)} disabled={loading}
                    className="text-[11px] px-3 py-1 rounded bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white disabled:opacity-50">
                    더 불러오기
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
