"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Item = {
  id: string
  settlement_id: string
  settlement_status: string
  amount: number
  paid_amount: number
  remaining_amount: number
  note: string | null
  created_at: string
}
type Group = {
  membership_id: string
  name: string
  total_amount: number
  paid_amount: number
  remaining_amount: number
  items: Item[]
}

const won = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "-")

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    confirmed: "bg-amber-500/15 text-amber-300",
    paid: "bg-emerald-500/15 text-emerald-300",
  }
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${map[s] ?? "bg-slate-500/15 text-slate-300"}`}>{s}</span>
}

export default function HostessPayoutsPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [payoutFor, setPayoutFor] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [payoutType, setPayoutType] = useState<"full" | "partial">("full")
  const [memo, setMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState("")
  const [role, setRole] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "partial" | "paid">("all")

  useEffect(() => {
    ;(async () => {
      const meRes = await apiFetch("/api/auth/me")
      if (meRes.ok) setRole((await meRes.json()).role ?? "")
      await load()
    })()
  }, [])

  async function load() {
    setLoading(true); setError("")
    try {
      const res = await apiFetch("/api/settlements/hostesses")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (!res.ok) { setError("데이터를 불러올 수 없습니다."); return }
      const data = await res.json()
      setGroups(data.hostesses ?? [])
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  async function submitPayout(item: Item) {
    if (submitting) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setFlash("금액을 확인하세요."); return }
    setSubmitting(true); setFlash("")
    try {
      const res = await apiFetch("/api/settlement/payout", {
        method: "POST",
        body: JSON.stringify({
          settlement_item_id: item.id,
          amount: amt,
          payout_type: payoutType,
          memo: memo || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setFlash(data?.message || data?.error || "지급 실패"); return }
      setFlash("지급 완료")
      setPayoutFor(null); setAmount(""); setMemo(""); setPayoutType("full")
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const canPayout = role === "owner" || role === "manager"
  const filtered = groups
    .filter(g => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter(g => {
      if (statusFilter === "all") return true
      if (statusFilter === "paid") return g.remaining_amount === 0 && g.paid_amount > 0
      if (statusFilter === "unpaid") return g.paid_amount === 0 && g.remaining_amount > 0
      if (statusFilter === "partial") return g.paid_amount > 0 && g.remaining_amount > 0
      return true
    })

  return (
    <main className="min-h-screen bg-[#030814] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/payouts")} className="text-xs text-slate-400 hover:text-slate-200">← 정산 현황</button>
          <h1 className="mt-1 text-lg font-semibold">아가씨 지급</h1>
        </div>
        <button onClick={load} className="text-xs text-slate-400 hover:text-slate-200">새로고침</button>
      </header>

      <div className="p-5 space-y-4">
        <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-wrap gap-2 items-center text-xs">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이름으로 검색"
            className="flex-1 min-w-[120px] rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
          />
          <div className="flex gap-1">
            {(["all", "unpaid", "partial", "paid"] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2 py-1 ${statusFilter === s ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "border border-white/10 text-slate-400"}`}
              >
                {s === "all" ? "전체" : s === "unpaid" ? "미지급" : s === "partial" ? "부분" : "완료"}
              </button>
            ))}
          </div>
        </section>
        {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {flash && <p className="text-sm text-emerald-300">{flash}</p>}
        {!loading && filtered.length === 0 && <p className="text-sm text-slate-500">표시할 아가씨가 없습니다.</p>}

        {filtered.map(g => (
          <section key={g.membership_id} className="rounded-lg border border-white/10 bg-white/[0.04]">
            <button
              onClick={() => setExpanded(expanded === g.membership_id ? null : g.membership_id)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div>
                <p className="text-sm font-medium">{g.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{g.items.length}건 · 총 {won(g.total_amount)} · 지급 {won(g.paid_amount)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-amber-300">{won(g.remaining_amount)}</p>
                <p className="text-[10px] text-slate-500">미지급</p>
              </div>
            </button>

            {expanded === g.membership_id && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {g.items.map(it => (
                  <div key={it.id} className="rounded border border-white/5 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <StatusBadge s={it.settlement_status} />
                      <span className="text-[10px] text-slate-500">{new Date(it.created_at).toLocaleDateString("ko-KR")}</span>
                    </div>
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-slate-400">금액</span>
                      <span>{won(it.amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">지급</span>
                      <span className="text-emerald-300">{won(it.paid_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">잔액</span>
                      <span className="text-amber-300">{won(it.remaining_amount)}</span>
                    </div>
                    {it.note && <p className="mt-1 text-[11px] text-slate-500">{it.note}</p>}

                    {canPayout && it.remaining_amount > 0 && (
                      payoutFor === it.id ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex gap-2">
                            <button onClick={() => { setPayoutType("full"); setAmount(String(it.remaining_amount)) }} className={`flex-1 rounded border px-2 py-1 text-xs ${payoutType === "full" ? "border-emerald-500 text-emerald-300" : "border-white/10 text-slate-400"}`}>전액</button>
                            <button onClick={() => setPayoutType("partial")} className={`flex-1 rounded border px-2 py-1 text-xs ${payoutType === "partial" ? "border-emerald-500 text-emerald-300" : "border-white/10 text-slate-400"}`}>부분</button>
                          </div>
                          <input
                            type="number"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            placeholder="금액"
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                          />
                          <input
                            value={memo}
                            onChange={e => setMemo(e.target.value)}
                            placeholder="메모 (선택)"
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs"
                          />
                          <div className="flex gap-2">
                            <button disabled={submitting} onClick={() => submitPayout(it)} className="flex-1 rounded bg-emerald-500/80 px-3 py-1.5 text-xs font-medium text-slate-900 disabled:opacity-50">확인</button>
                            <button onClick={() => { setPayoutFor(null); setAmount(""); setMemo("") }} className="flex-1 rounded border border-white/10 px-3 py-1.5 text-xs">취소</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setPayoutFor(it.id); setPayoutType("full"); setAmount(String(it.remaining_amount)); setMemo("") }}
                          className="mt-3 w-full rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300"
                        >
                          지급
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
