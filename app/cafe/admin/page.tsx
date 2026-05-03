"use client"

/**
 * /cafe/admin — super_admin 전용 카페 운영 현황.
 *   모든 카페 매장 한 화면에 + 오늘 매출 + 진행 중 주문 수.
 *   각 카페 클릭하면 그 카페 inbox 로 이동 (super_admin 권한으로 읽음).
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type CafeOverview = {
  id: string
  store_name: string
  floor: number
  menu_active: number
  account: { is_active: boolean; has_number: boolean }
  all_time: { pending: number; preparing: number; delivering: number; delivered: number; cancelled: number }
  today: { count: number; gross: number; delivered: number }
}

function fmt(n: number) { return "₩" + n.toLocaleString() }

export default function CafeAdminPage() {
  const [cafes, setCafes] = useState<CafeOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await apiFetch("/api/cafe/admin/overview")
      const d = await r.json()
      if (r.status === 401 || r.status === 403) {
        setError("super_admin 만 접근 가능합니다"); return
      }
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      setCafes(d.cafes ?? [])
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold">☕ 카페 운영 현황 <span className="text-xs text-amber-300 ml-2">super_admin 뷰</span></h1>
          <button onClick={load} className="text-xs px-3 py-1.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200">새로고침</button>
        </div>

        {error && <div className="p-2 mb-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {loading && cafes.length === 0 ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : cafes.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">등록된 카페가 없습니다 (3층 매장)</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {cafes.map((c) => {
              const inProgress = c.all_time.pending + c.all_time.preparing + c.all_time.delivering
              return (
                <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-base font-semibold">{c.store_name}</div>
                      <div className="text-[11px] text-slate-400">{c.floor}F</div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded ${c.menu_active > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}`}>
                        메뉴 {c.menu_active}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded ${c.account.has_number && c.account.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>
                        {c.account.has_number ? (c.account.is_active ? "계좌✓" : "계좌(off)") : "계좌없음"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-amber-500/10 p-2">
                      <div className="text-amber-300 font-semibold">{c.all_time.pending}</div>
                      <div className="text-[10px] text-slate-400">신규</div>
                    </div>
                    <div className="rounded-lg bg-cyan-500/10 p-2">
                      <div className="text-cyan-300 font-semibold">{c.all_time.preparing + c.all_time.delivering}</div>
                      <div className="text-[10px] text-slate-400">준비/배달</div>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 p-2">
                      <div className="text-emerald-300 font-semibold">{c.today.delivered}</div>
                      <div className="text-[10px] text-slate-400">오늘완료</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                    <span className="text-slate-400">오늘 매출</span>
                    <span className="font-semibold text-emerald-300 tabular-nums">{fmt(c.today.gross)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Link
                      href={`/cafe/admin/${c.id}/inbox`}
                      className="text-center py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-xs font-semibold"
                    >📋 주문 inbox</Link>
                    <span className="text-center py-2 rounded-lg bg-white/[0.04] border border-white/10 text-[10px] text-slate-400">
                      진행 {inProgress} · 취소 {c.all_time.cancelled}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
