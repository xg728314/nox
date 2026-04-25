"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtWon } from "@/lib/format"

type SettlementItem = {
  hostess_id: string
  hostess_name?: string
  has_settlement: boolean
  status: string | null
  gross_total: number | null
  hostess_amount: number | null
  manager_amount: number | null
  tc_amount: number | null
}

export default function SettlementPage() {
  const router = useRouter()
  const [overview, setOverview] = useState<SettlementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [role, setRole] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const meRes = await apiFetch("/api/auth/me")
      if (meRes.status === 401 || meRes.status === 403) { router.push("/login"); return }
      const meData = await meRes.json()
      setRole(meData.role)

      if (meData.role === "owner") {
        const res = await apiFetch("/api/store/settlement/overview")
        if (res.ok) {
          const data = await res.json()
          setOverview((data.overview || []).map((o: { hostess_id: string; hostess_name: string; has_settlement: boolean; status: string | null; gross_total?: number | null; hostess_amount?: number | null; manager_amount?: number | null; tc_amount?: number | null }) => ({
            ...o,
            gross_total: o.gross_total ?? null,
            hostess_amount: o.hostess_amount ?? null,
            manager_amount: o.manager_amount ?? null,
            tc_amount: o.tc_amount ?? null,
          })))
        }
      } else if (meData.role === "manager") {
        const res = await apiFetch("/api/manager/settlement/summary")
        if (res.ok) {
          const data = await res.json()
          setOverview((data.summary || []).map((s: { hostess_id: string; hostess_name: string; has_settlement: boolean; status: string | null; gross_total?: number | null; hostess_amount?: number | null; manager_amount?: number | null; tc_amount?: number | null }) => ({
            hostess_id: s.hostess_id,
            hostess_name: s.hostess_name,
            has_settlement: s.has_settlement,
            status: s.status,
            gross_total: s.gross_total ?? null,
            hostess_amount: s.hostess_amount ?? null,
            manager_amount: s.manager_amount ?? null,
            tc_amount: s.tc_amount ?? null,
          })))
        }
      } else if (meData.role === "hostess") {
        const res = await apiFetch("/api/me/settlement-status")
        if (res.ok) {
          const data = await res.json()
          const ss = data.settlement_status
          if (ss) {
            setOverview([{ hostess_id: meData.user_id, has_settlement: ss.has_settlement, status: ss.status, gross_total: null, hostess_amount: null, manager_amount: null, tc_amount: null }])
          }
        }
      }
    } catch {
      setError("정산 데이터를 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

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
          <button
            onClick={() => {
              // 2026-04-25: 정산 ↔ 이력 루프 방지.
              //   referrer 가 /settlement/history 면 단순 back() 은 이력 페이지
              //   로 돌아가서 루프. 역할별 기본 홈으로 replace.
              if (typeof window !== "undefined") {
                const ref = document.referrer
                const fromHistoryLoop = ref && ref.includes("/settlement/history")
                if (!fromHistoryLoop && window.history.length > 1) {
                  router.back()
                  return
                }
              }
              const home =
                role === "owner" ? "/owner" :
                role === "manager" ? "/manager" :
                role === "hostess" ? "/me" :
                "/counter"
              router.replace(home)
            }}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">정산 확인</span>
          <div className="text-xs text-slate-400">{role === "owner" ? "사장" : role === "manager" ? "실장" : "스태프"}</div>
        </div>

        {/* 요약 */}
        <div className="px-4 py-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">정산 현황</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-300">
                  {overview.filter(o => o.has_settlement).length}
                  <span className="text-base text-slate-400"> / {overview.length}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">
                  {role === "owner" ? "전체 스태프" : role === "manager" ? "담당 스태프" : "내 정산"}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  완료 {overview.filter(o => o.status === "finalized").length} ·
                  대기 {overview.filter(o => o.status === "draft").length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 정산 목록 */}
        <div className="px-4 space-y-3">
          {overview.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📊</div>
              <p className="text-slate-500 text-sm">정산 데이터가 없습니다.</p>
            </div>
          )}
          {overview.map((item, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
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
                    <div className="text-sm font-medium">
                      {role === "hostess" ? "내 정산" : (item.hostess_name || item.hostess_id.slice(0, 8))}
                    </div>
                    <div className="text-xs text-slate-400">
                      {item.has_settlement
                        ? item.status === "finalized" ? "정산 확정" : "정산 대기 (draft)"
                        : "정산 없음"
                      }
                    </div>
                  </div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full ${
                  item.status === "finalized"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : item.status === "draft"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-white/10 text-slate-500"
                }`}>
                  {item.status === "finalized" ? "확정" : item.status === "draft" ? "대기" : "없음"}
                </span>
              </div>
              {item.has_settlement && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                  {[
                    { label: "총 매출", value: item.gross_total },
                    { label: "TC", value: item.tc_amount },
                    { label: "실장", value: item.manager_amount },
                    { label: "스태프", value: item.hostess_amount },
                  ].map((f) => (
                    <div key={f.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{f.label}</span>
                      <span className="text-slate-300">{fmtWon(f.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 하단 네비 */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
        <div className="grid grid-cols-5 py-2">
          {[
            { label: "카운터", icon: "⊞", path: "/counter" },
            { label: "예약", icon: "📋", path: "#" },
            { label: "정산", icon: "💰", path: "/settlement" },
            { label: "스태프", icon: "👤", path: "/staff" },
            { label: "OPS", icon: "⚙", path: "#" },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => item.path !== "#" && router.push(item.path)}
              className={`flex flex-col items-center py-2 gap-1 text-xs ${item.path === "/settlement" ? "text-cyan-400" : "text-slate-500"}`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
