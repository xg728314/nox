"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type SettlementItem = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
}

export default function ManagerSettlementPage() {
  const router = useRouter()
  const [summary, setSummary] = useState<SettlementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/manager/settlement/summary")

      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }

      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary ?? [])
      } else {
        setError("정산 데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const finalizedCount = summary.filter((s) => s.status === "finalized").length
  const draftCount = summary.filter((s) => s.status === "draft").length
  const noneCount = summary.filter((s) => !s.has_settlement).length

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/manager")} className="text-cyan-400 text-sm">← 대시보드</button>
          <span className="font-semibold">매니저 정산 상세</span>
          <div className="w-16" />
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 요약 카드 */}
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-xs text-slate-400">확정</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">{finalizedCount}</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs text-slate-400">대기</div>
              <div className="mt-1 text-2xl font-semibold text-amber-300">{draftCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-slate-400">없음</div>
              <div className="mt-1 text-2xl font-semibold text-slate-400">{noneCount}</div>
            </div>
          </div>
        </div>

        {/* 정산 목록 */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-300">담당 스태프 정산</span>
            <span className="text-xs text-slate-500">{summary.length}명</span>
          </div>

          {summary.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">💰</div>
              <p className="text-slate-500 text-sm">정산 데이터가 없습니다.</p>
            </div>
          )}

          <div className="space-y-2">
            {summary.map((item) => (
              <div
                key={item.hostess_id}
                onClick={() => router.push(`/manager/settlement/${item.hostess_id}`)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 cursor-pointer hover:bg-white/[0.06] transition-colors active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm ${
                      item.has_settlement
                        ? item.status === "finalized"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                        : "bg-white/10 text-slate-500"
                    }`}>
                      {item.has_settlement ? (item.status === "finalized" ? "✓" : "◷") : "−"}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{item.hostess_name || item.hostess_id.slice(0, 8)}</div>
                      <div className="text-xs text-slate-500">
                        {item.has_settlement
                          ? item.status === "finalized" ? "정산 확정" : "정산 대기 (draft)"
                          : "정산 없음"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-3 py-1 rounded-full ${
                      item.status === "finalized"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : item.status === "draft"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                    }`}>
                      {item.status === "finalized" ? "확정" : item.status === "draft" ? "대기" : "없음"}
                    </span>
                    <span className="text-slate-600 text-sm">→</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
