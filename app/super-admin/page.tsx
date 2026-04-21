"use client"

/**
 * /super-admin — Global monitoring dashboard.
 * Requires role `super_admin` (middleware-gated). Read-only. Polls every
 * 20s to surface near-real-time operational state across all stores.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type StoreCard = {
  store_uuid: string
  store_name: string
  store_code: string | null
  floor: number | null
  is_active: boolean
  business_day_id: string | null
  business_day_status: string | null
  active_rooms: number
  active_sessions: number
  checkout_pending: number
  unsettled_count: number
  gross_total_today: number
  credit_outstanding: number
}

type FloorGroup = { floor: number | "unknown"; stores: StoreCard[] }

type DashboardData = {
  summary: {
    total_stores: number
    open_stores: number
    active_sessions: number
    active_rooms: number
    gross_total_today: number
    credit_outstanding: number
    unsettled_count: number
  }
  floors: FloorGroup[]
}

const POLL_MS = 20_000

function fmtWon(n: number) {
  if (!Number.isFinite(n)) return "0원"
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`
  if (n >= 10_000) return `${Math.floor(n / 10_000).toLocaleString()}만`
  return `${n.toLocaleString()}원`
}

function floorLabel(f: number | "unknown") {
  return f === "unknown" ? "층 미지정" : `${f}층`
}

function statusBadge(st: string | null, active: boolean) {
  if (!active) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">비활성</span>
  if (st === "open") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">영업중</span>
  if (st === "closed") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">마감</span>
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">영업일 미시작</span>
}

export default function SuperAdminDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    try {
      const res = await apiFetch("/api/super-admin/dashboard", { cache: "no-store" })
      if (res.status === 401) { router.push("/login"); return }
      if (res.status === 403) { setError("권한이 없습니다."); setLoading(false); return }
      if (!res.ok) { setError("대시보드 로드 실패"); setLoading(false); return }
      const body = await res.json()
      setData(body)
      setError("")
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white antialiased">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight">전역 운영 모니터</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
              SUPER ADMIN
            </span>
            {data && (
              <span className="text-[11px] text-slate-400">
                {data.summary.open_stores}/{data.summary.total_stores} 영업중
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              className="text-[11px] text-slate-400 hover:text-cyan-300"
              title="즉시 새로고침"
            >
              ↻ {POLL_MS / 1000}초마다 갱신
            </button>
            <Link href="/super-admin/location-corrections" className="text-[11px] text-cyan-300 hover:text-cyan-100 font-semibold">
              위치 검수 로그
            </Link>
            <Link href="/counter" className="text-[11px] text-slate-400 hover:text-white">
              카운터로
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">로딩 중…</div>
      )}

      {data && (
        <>
          {/* KPI strip */}
          <div className="px-4 py-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <Kpi label="전체 매장" value={data.summary.total_stores.toString()} />
            <Kpi label="영업중" value={data.summary.open_stores.toString()} accent="emerald" />
            <Kpi label="활성 세션" value={data.summary.active_sessions.toString()} accent="cyan" />
            <Kpi label="사용중 룸" value={data.summary.active_rooms.toString()} accent="cyan" />
            <Kpi label="오늘 총매출" value={fmtWon(data.summary.gross_total_today)} accent="emerald" />
            <Kpi label="미수 총액" value={fmtWon(data.summary.credit_outstanding)} accent="amber" />
            <Kpi label="정산 대기" value={data.summary.unsettled_count.toString()} accent="amber" />
          </div>

          {/* Floors */}
          <div className="px-4 pb-16 space-y-6">
            {data.floors.map((fg) => (
              <section key={String(fg.floor)}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-sm font-bold text-slate-200">{floorLabel(fg.floor)}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                    {fg.stores.length}개 매장
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {fg.stores.map((s) => (
                    <Link
                      key={s.store_uuid}
                      href={`/super-admin/stores/${s.store_uuid}`}
                      className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07] hover:border-cyan-500/30 transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-base font-semibold">{s.store_name}</div>
                          <div className="text-[10px] text-slate-500">
                            {s.floor ? `${s.floor}층` : ""}
                            {s.store_code ? ` · ${s.store_code}` : ""}
                          </div>
                        </div>
                        {statusBadge(s.business_day_status, s.is_active)}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <Stat label="활성 룸" value={s.active_rooms} />
                        <Stat label="활성 세션" value={s.active_sessions} />
                        <Stat
                          label="체크아웃 대기"
                          value={s.checkout_pending}
                          warn={s.checkout_pending > 0}
                        />
                        <Stat
                          label="미정산"
                          value={s.unsettled_count}
                          warn={s.unsettled_count > 0}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">오늘 매출</span>
                        <span className="font-semibold text-emerald-300">
                          {fmtWon(s.gross_total_today)}
                        </span>
                      </div>
                      {s.credit_outstanding > 0 && (
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="text-slate-400">미수</span>
                          <span className="font-semibold text-amber-300">
                            {fmtWon(s.credit_outstanding)}
                          </span>
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "cyan" | "emerald" | "amber" }) {
  const color =
    accent === "emerald" ? "text-emerald-300" :
    accent === "cyan" ? "text-cyan-300" :
    accent === "amber" ? "text-amber-300" :
    "text-white"
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${warn ? "text-amber-300" : "text-slate-200"}`}>{value}</span>
    </div>
  )
}
