"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Receipt = {
  receipt_id: string
  session_id: string
  business_date: string | null
  version: number
  gross_total: number
  tc_amount: number
  manager_amount: number
  hostess_amount: number
  margin_amount: number
  status: string
  created_at: string
}

export default function SettlementHistoryPage() {
  const router = useRouter()
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/settlement/history")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setReceipts(data.receipts ?? [])
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#030814] flex items-center justify-center"><div className="text-cyan-400 text-sm">로딩 중...</div></div>
  }

  // 영업일별 그룹
  const byDate = new Map<string, Receipt[]>()
  for (const r of receipts) {
    const key = r.business_date || "미지정"
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(r)
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/settlement")} className="text-cyan-400 text-sm">← 정산</button>
          <span className="font-semibold">정산 이력</span>
          <span className="text-xs text-slate-500">{receipts.length}건</span>
        </div>

        {error && <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        <div className="px-4 py-4 space-y-4">
          {receipts.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📊</div>
              <p className="text-slate-500 text-sm">정산 이력이 없습니다.</p>
            </div>
          )}

          {[...byDate.entries()].map(([date, items]) => (
            <div key={date} className="space-y-2">
              <div className="text-xs text-slate-400 px-1">{date}</div>
              {items.map((r) => (
                <div key={r.receipt_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">세션 {r.session_id.slice(0, 8)}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "finalized" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                      {r.status === "finalized" ? "확정" : "임시"}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-[10px] text-slate-500">매출</div>
                      <div className="text-xs font-medium text-white">{(r.gross_total / 10000).toFixed(0)}만</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">TC</div>
                      <div className="text-xs font-medium text-blue-300">{(r.tc_amount / 10000).toFixed(0)}만</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">실장</div>
                      <div className="text-xs font-medium text-purple-300">{(r.manager_amount / 10000).toFixed(0)}만</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">마진</div>
                      <div className="text-xs font-medium text-emerald-300">{(r.margin_amount / 10000).toFixed(0)}만</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
