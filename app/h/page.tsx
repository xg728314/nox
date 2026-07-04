"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtDateKo, fmtMoney, fmtMoneyWon } from "../m/_lib/format"

/**
 * 아가씨 셀프 앱 홈 (/h).
 *   - 오늘 / 이번주 매출 카드
 *   - 지금 일하는 세션 (있으면)
 *   - 대기중 정산
 *
 * R-hostess-app (2026-06-28).
 */
type DashboardData = {
  today: { date: string; gross: number; payout: number; count: number }
  week: { gross: number; count: number; prev_week_gross: number }
  current: {
    session_id: string
    category: string | null
    time_minutes: number | null
    entered_at: string
    remaining_minutes: number | null
    store_name: string | null
  } | null
  pending: { count: number; total: number }
}

export default function HostessHomePage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/hostess/dashboard")
        if (res.status === 401) {
          router.push("/login")
          return
        }
        if (res.status === 403) {
          // hostess 아니면 실장 앱으로
          router.push("/m")
          return
        }
        if (!res.ok) {
          setErr(`HTTP ${res.status}`)
          return
        }
        const j = (await res.json()) as DashboardData
        if (!cancelled) setData(j)
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const weekDelta = data
    ? data.week.gross - data.week.prev_week_gross
    : 0
  const weekDeltaPct =
    data && data.week.prev_week_gross > 0
      ? Math.round((weekDelta / data.week.prev_week_gross) * 100)
      : 0

  return (
    <div
      className="min-h-screen bg-[#FAF5EC] text-[#2D2B26]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="px-5 pt-4 pb-3">
        <div className="text-[11px] font-semibold text-[#7A746A]">
          {fmtDateKo()}
        </div>
        <div className="text-[22px] font-extrabold tracking-tight mt-1">
          오늘도 화이팅 ✨
        </div>
      </header>

      <main className="px-5 pb-24 space-y-3">
        {err && (
          <div className="text-red-600 text-[12px] text-center py-4">{err}</div>
        )}

        {/* 지금 일하는 세션 */}
        {data?.current && (
          <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-3xl p-5 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-[11px] font-extrabold uppercase tracking-widest">
                일하는 중
              </span>
            </div>
            <div className="text-[18px] font-extrabold">
              {data.current.store_name ?? "?"} · {data.current.category ?? "?"}
            </div>
            {data.current.remaining_minutes != null && (
              <div className="text-[36px] font-extrabold tabular-nums mt-2 leading-none">
                {data.current.remaining_minutes > 0
                  ? `${data.current.remaining_minutes}분`
                  : "종료"}
                {data.current.remaining_minutes > 0 && (
                  <span className="text-[14px] font-bold ml-1 opacity-80">
                    남음
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 오늘 카드 */}
        <div className="bg-white rounded-3xl p-5 border border-[#D8D2C8]/60 shadow-sm">
          <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-widest">
            오늘
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-[36px] font-extrabold tracking-tighter">
              {data ? fmtMoney(data.today.payout, { unit: false }) : "—"}
            </span>
            <span className="text-[14px] font-bold text-[#7A746A]">만원</span>
          </div>
          <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
            {data?.today.count ?? 0} 타임 · 매출 {data ? fmtMoneyWon(data.today.gross) : "—"}
          </div>
        </div>

        {/* 이번 주 카드 */}
        <div className="bg-white rounded-3xl p-5 border border-[#D8D2C8]/60 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-widest">
                이번 주
              </div>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-[24px] font-extrabold tracking-tighter">
                  {data ? fmtMoneyWon(data.week.gross) : "—"}
                </span>
              </div>
              <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                {data?.week.count ?? 0} 타임
              </div>
            </div>
            {data && data.week.prev_week_gross > 0 && (
              <div
                className={`text-right ${weekDelta > 0 ? "text-green-600" : weekDelta < 0 ? "text-red-600" : "text-[#7A746A]"}`}
              >
                <div className="text-[10px] font-bold">지난주比</div>
                <div className="text-[16px] font-extrabold">
                  {weekDelta > 0 ? "+" : ""}
                  {weekDeltaPct}%
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 대기중 정산 */}
        <div className="bg-[#F0E8D8] rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-widest">
                받을 돈 (미정산)
              </div>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-[24px] font-extrabold tracking-tighter text-[#A87D45]">
                  {data ? fmtMoneyWon(data.pending.total) : "—"}
                </span>
              </div>
              <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                {data?.pending.count ?? 0} 건 대기
              </div>
            </div>
            <Link
              href="/me/settlements"
              className="text-[10px] font-extrabold bg-white rounded-full px-3 py-2 text-[#A87D45] border border-[#D8D2C8]"
            >
              상세 →
            </Link>
          </div>
        </div>

        {/* 로그아웃 */}
        <div className="pt-4 text-center">
          <button
            type="button"
            onClick={async () => {
              try {
                await apiFetch("/api/auth/logout", { method: "POST" })
              } catch {}
              try {
                localStorage.removeItem("nox.auto_login.enabled")
                localStorage.removeItem("nox.auto_login.email")
                localStorage.removeItem("nox.auto_login.password")
              } catch {}
              router.push("/login")
            }}
            className="text-[11px] font-bold text-[#7A746A] underline underline-offset-2"
          >
            로그아웃
          </button>
        </div>
      </main>
    </div>
  )
}
