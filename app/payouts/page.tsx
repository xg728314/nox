"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type RoleRollup = { amount: number; paid: number; remaining: number; count: number }
type Overview = {
  rollup: { hostess: RoleRollup; manager: RoleRollup; store: RoleRollup }
  settlement_status_count: Record<string, number>
  recent_payouts: Array<{
    id: string
    recipient_type: string
    recipient_membership_id: string | null
    amount: number | string
    currency: string
    status: string
    payout_type: string
    memo: string | null
    paid_at: string | null
    created_at: string
  }>
  cross_store: {
    status_count: Record<string, number>
    remaining_total: number
  }
}

const won = (n: number | string | null | undefined) => {
  const v = typeof n === "number" ? n : Number(n ?? 0)
  return Number.isFinite(v) ? v.toLocaleString("ko-KR") + "원" : "-"
}

export default function PayoutsOverviewPage() {
  const router = useRouter()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    ;(async () => {
      const meRes = await apiFetch("/api/auth/me")
      if (meRes.status === 401 || meRes.status === 403) { router.push("/login"); return }
      const me = await meRes.json().catch(() => ({}))
      if (me.role !== "owner" && me.role !== "manager") { router.push("/"); return }
      await load()
    })()
  }, [])

  async function load() {
    setLoading(true); setError("")
    try {
      const res = await apiFetch("/api/settlements/overview")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (!res.ok) { setError("데이터를 불러올 수 없습니다."); return }
      setData(await res.json())
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#030814] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/counter" className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors">
            <span className="text-lg">&larr;</span>
            <span className="text-xs">카운터</span>
          </a>
          <h1 className="text-lg font-semibold">정산 현황</h1>
        </div>
        <button onClick={load} className="text-xs text-slate-400 hover:text-slate-200">새로고침</button>
      </header>

      <div className="p-5 space-y-5">
        {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        {data && (
          <>
            <section className="grid grid-cols-3 gap-3">
              {(["hostess", "manager", "store"] as const).map(k => {
                const r = data.rollup[k]
                const label = k === "hostess" ? "아가씨" : k === "manager" ? "실장" : "매장"
                return (
                  <div key={k} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-2 text-lg font-semibold">{won(r.remaining)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">미지급 / 총 {won(r.amount)}</p>
                    <p className="text-[11px] text-slate-500">{r.count}건</p>
                  </div>
                )
              })}
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs text-slate-400 mb-2">정산서 상태</p>
              <div className="flex gap-4 text-sm">
                <span className="text-slate-300">draft <b>{data.settlement_status_count.draft ?? 0}</b></span>
                <span className="text-amber-300">confirmed <b>{data.settlement_status_count.confirmed ?? 0}</b></span>
                <span className="text-emerald-300">paid <b>{data.settlement_status_count.paid ?? 0}</b></span>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <button onClick={() => router.push("/payouts/managers")} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08]">
                <p className="text-sm font-medium">실장 지급</p>
                <p className="mt-1 text-[11px] text-slate-500">{won(data.rollup.manager.remaining)} 미지급</p>
              </button>
              <button onClick={() => router.push("/payouts/hostesses")} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08]">
                <p className="text-sm font-medium">아가씨 지급</p>
                <p className="mt-1 text-[11px] text-slate-500">{won(data.rollup.hostess.remaining)} 미지급</p>
              </button>
              <button onClick={() => router.push("/payouts/cross-store")} className="col-span-2 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08]">
                <p className="text-sm font-medium">교차정산</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  open {data.cross_store.status_count.open ?? 0} / partial {data.cross_store.status_count.partial ?? 0} / completed {data.cross_store.status_count.completed ?? 0} · 잔액 {won(data.cross_store.remaining_total)}
                </p>
              </button>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs text-slate-400 mb-3">최근 지급</p>
              {data.recent_payouts.length === 0 ? (
                <p className="text-xs text-slate-500">지급 내역이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recent_payouts.map(p => (
                    <li key={p.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="text-slate-300">{p.recipient_type}</span>
                        <span className="ml-2 text-[11px] text-slate-500">{p.payout_type}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-100">{won(p.amount)}</p>
                        <p className="text-[10px] text-slate-500">{new Date(p.created_at).toLocaleString("ko-KR")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
