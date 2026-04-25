"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Overview = {
  revenue: { total: number; profit: number; settlement_count: number }
  settlement_status_count: Record<string, number>
  payouts: { total_amount: number; total_paid: number; total_remaining: number }
  by_role: {
    hostess: { amount: number; paid: number; remaining: number }
    manager: { amount: number; paid: number; remaining: number }
  }
  cross_store: { total: number; paid: number; remaining: number; open: number; partial: number; completed: number }
}
type ManagerRow = { membership_id: string; name: string; total_amount: number; paid_amount: number; remaining_amount: number; hostess_count: number }
type HostessRow = { membership_id: string; name: string; total_amount: number; paid_amount: number; remaining_amount: number; state: string }
type CrossStoreRow = { to_store_uuid: string; store_name: string; header_count: number; total_amount: number; paid_amount: number; remaining_amount: number; open_count: number; partial_count: number; completed_count: number }
type PayoutRow = {
  id: string
  amount: number
  status: string
  payout_type: string
  recipient_type: string | null
  note: string | null
  created_at: string
  cancelled_at: string | null
  cancel_reason: string | null
}
type Activity = {
  recent_payouts: PayoutRow[]
  recent_cross_store_payouts: PayoutRow[]
  recent_cancels: PayoutRow[]
}

const won = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "-")

export default function ReportsOverviewPage() {
  const router = useRouter()
  const [tab, setTab] = useState<"overview" | "managers" | "hostesses" | "cross" | "activity">("overview")
  const [overview, setOverview] = useState<Overview | null>(null)
  const [managers, setManagers] = useState<ManagerRow[]>([])
  const [hostesses, setHostesses] = useState<HostessRow[]>([])
  const [crossStores, setCrossStores] = useState<CrossStoreRow[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    ;(async () => {
      setLoading(true); setError("")
      try {
        const [o, m, h, c, a] = await Promise.all([
          apiFetch("/api/reports/overview"),
          apiFetch("/api/reports/managers"),
          apiFetch("/api/reports/hostesses"),
          apiFetch("/api/reports/cross-store"),
          apiFetch("/api/reports/activity"),
        ])
        if ([o, m, h, c, a].some(r => r.status === 401 || r.status === 403)) {
          router.push("/login"); return
        }
        if (o.ok) setOverview(await o.json())
        if (m.ok) setManagers((await m.json()).managers ?? [])
        if (h.ok) setHostesses((await h.json()).hostesses ?? [])
        if (c.ok) setCrossStores((await c.json()).stores ?? [])
        if (a.ok) setActivity(await a.json())
      } catch {
        setError("네트워크 오류")
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <main className="min-h-screen bg-[#030814] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/reports")} className="text-xs text-slate-400 hover:text-slate-200">← 리포트</button>
          <h1 className="mt-1 text-lg font-semibold">정산 리포트 개요</h1>
        </div>
      </header>

      <nav className="border-b border-white/10 px-5 py-2 flex gap-2 text-xs">
        {([
          ["overview", "개요"],
          ["managers", "실장"],
          ["hostesses", "스태프"],
          ["cross", "교차정산"],
          ["activity", "최근 활동"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 ${tab === k ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "border border-white/10 text-slate-400"}`}
          >{label}</button>
        ))}
      </nav>

      <div className="p-5 space-y-4">
        {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        {!loading && tab === "overview" && overview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Card label="총 매출" value={won(overview.revenue.total)} />
              <Card label="사장 수익" value={won(overview.revenue.profit)} />
              <Card label="총 지급 금액" value={won(overview.payouts.total_paid)} />
              <Card label="미지급 금액" value={won(overview.payouts.total_remaining)} accent="amber" />
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2 text-xs">
              <p className="text-slate-400">역할별</p>
              <Row label="실장" amount={overview.by_role.manager.amount} paid={overview.by_role.manager.paid} remaining={overview.by_role.manager.remaining} />
              <Row label="스태프" amount={overview.by_role.hostess.amount} paid={overview.by_role.hostess.paid} remaining={overview.by_role.hostess.remaining} />
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs space-y-1">
              <p className="text-slate-400">교차정산</p>
              <div className="flex justify-between"><span>총액</span><span>{won(overview.cross_store.total)}</span></div>
              <div className="flex justify-between"><span>지급</span><span className="text-emerald-300">{won(overview.cross_store.paid)}</span></div>
              <div className="flex justify-between"><span>미지급</span><span className="text-amber-300">{won(overview.cross_store.remaining)}</span></div>
              <div className="mt-1 text-[11px] text-slate-500">open {overview.cross_store.open} · partial {overview.cross_store.partial} · completed {overview.cross_store.completed}</div>
            </div>
          </div>
        )}

        {!loading && tab === "managers" && (
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left py-1">실장</th><th>담당</th><th className="text-right">총액</th><th className="text-right">지급</th><th className="text-right">미지급</th></tr></thead>
            <tbody>
              {managers.map(m => (
                <tr key={m.membership_id} className="border-t border-white/5">
                  <td className="py-2">{m.name}</td>
                  <td className="text-center">{m.hostess_count}</td>
                  <td className="text-right">{won(m.total_amount)}</td>
                  <td className="text-right text-emerald-300">{won(m.paid_amount)}</td>
                  <td className="text-right text-amber-300">{won(m.remaining_amount)}</td>
                </tr>
              ))}
              {managers.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-6">데이터 없음</td></tr>}
            </tbody>
          </table>
        )}

        {!loading && tab === "hostesses" && (
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left py-1">스태프</th><th>상태</th><th className="text-right">총액</th><th className="text-right">지급</th><th className="text-right">미지급</th></tr></thead>
            <tbody>
              {hostesses.map(h => (
                <tr key={h.membership_id} className="border-t border-white/5">
                  <td className="py-2">{h.name}</td>
                  <td className="text-center text-slate-400">{h.state}</td>
                  <td className="text-right">{won(h.total_amount)}</td>
                  <td className="text-right text-emerald-300">{won(h.paid_amount)}</td>
                  <td className="text-right text-amber-300">{won(h.remaining_amount)}</td>
                </tr>
              ))}
              {hostesses.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-6">데이터 없음</td></tr>}
            </tbody>
          </table>
        )}

        {!loading && tab === "cross" && (
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left py-1">상대 매장</th><th>건수</th><th className="text-right">총액</th><th className="text-right">지급</th><th className="text-right">미지급</th></tr></thead>
            <tbody>
              {crossStores.map(s => (
                <tr key={s.to_store_uuid} className="border-t border-white/5">
                  <td className="py-2">{s.store_name}</td>
                  <td className="text-center">{s.header_count}</td>
                  <td className="text-right">{won(s.total_amount)}</td>
                  <td className="text-right text-emerald-300">{won(s.paid_amount)}</td>
                  <td className="text-right text-amber-300">{won(s.remaining_amount)}</td>
                </tr>
              ))}
              {crossStores.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-6">데이터 없음</td></tr>}
            </tbody>
          </table>
        )}

        {!loading && tab === "activity" && activity && (
          <div className="space-y-4">
            <ActivityList title="최근 지급" rows={activity.recent_payouts} />
            <ActivityList title="교차정산 지급" rows={activity.recent_cross_store_payouts} />
            <ActivityList title="취소/반전" rows={activity.recent_cancels} />
          </div>
        )}
      </div>
    </main>
  )
}

function Card({ label, value, accent }: { label: string; value: string; accent?: "amber" }) {
  const cls = accent === "amber" ? "text-amber-300" : "text-slate-100"
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  )
}

function Row({ label, amount, paid, remaining }: { label: string; amount: number; paid: number; remaining: number }) {
  return (
    <div className="flex justify-between text-slate-300">
      <span className="text-slate-400">{label}</span>
      <span>총 {won(amount)} · 지급 <span className="text-emerald-300">{won(paid)}</span> · 미지급 <span className="text-amber-300">{won(remaining)}</span></span>
    </div>
  )
}

function ActivityList({ title, rows }: { title: string; rows: PayoutRow[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="text-xs text-slate-400 mb-2">{title} ({rows.length})</p>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.id} className="flex justify-between text-[11px] text-slate-300 border-t border-white/5 pt-1">
            <span>{r.recipient_type ?? "—"} · {r.payout_type}</span>
            <span>{won(r.amount)}</span>
            <span className="text-slate-500">{new Date(r.created_at).toLocaleString("ko-KR")}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[11px] text-slate-500">없음</p>}
      </div>
    </div>
  )
}
