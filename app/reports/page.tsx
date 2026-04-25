"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import RevenueBreakdown from "./RevenueBreakdown"
import LiquorTarget from "./LiquorTarget"

type DailyTotals = {
  session_count: number
  gross_total: number
  tc_total: number
  manager_total: number
  hostess_total: number
  margin_total: number
  order_total: number
  participant_total: number
}

type HostessReport = {
  membership_id: string
  name: string
  stage_name: string | null
  total_price: number
  total_payout: number
  total_sessions: number
}

type ManagerReport = {
  manager_membership_id: string
  name: string
  nickname: string | null
  manager_sessions: number
  manager_total_price: number
  manager_total_payout: number
  assigned_hostess_count: number
  hostess_details: { membership_id: string; name: string; sessions: number; total_price: number; total_payout: number }[]
}

type Tab = "daily" | "hostess" | "manager"

export default function ReportsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("daily")
  const [businessDayId, setBusinessDayId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState("")

  // daily
  const [totals, setTotals] = useState<DailyTotals | null>(null)
  const [dayStatus, setDayStatus] = useState("")
  const [businessDate, setBusinessDate] = useState("")
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // hostess
  const [hostesses, setHostesses] = useState<HostessReport[]>([])

  // manager
  const [managers, setManagers] = useState<ManagerReport[]>([])

  // close/reopen
  const [actionLoading, setActionLoading] = useState(false)
  const profile = useCurrentProfile()
  const role = profile?.role ?? ""

  useEffect(() => {
    fetchBusinessDay()
  }, [])

  async function fetchBusinessDay() {
    try {
      const res = await apiFetch("/api/rooms")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        const bdId = data.business_day_id ?? null
        setBusinessDayId(bdId)
        if (bdId) await fetchTab("daily", bdId)
      }
    } catch {
      setError("영업일 정보를 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function fetchTab(t: Tab, bdId: string) {
    setTabLoading(true)
    setError("")
    try {
      if (t === "daily") {
        const res = await apiFetch(`/api/reports/daily?business_day_id=${bdId}`)
        if (res.ok) {
          const data = await res.json()
          setTotals(data.totals ?? null)
          setDayStatus(data.day_status ?? "")
          setBusinessDate(data.business_date ?? "")
        } else { setError("일일 리포트를 불러올 수 없습니다.") }
      } else if (t === "hostess") {
        const res = await apiFetch(`/api/reports/hostess?business_day_id=${bdId}`)
        if (res.ok) {
          const data = await res.json()
          setHostesses(data.hostesses ?? [])
          setBusinessDate(data.business_date ?? "")
        } else { setError("스태프 리포트를 불러올 수 없습니다.") }
      } else if (t === "manager") {
        const res = await apiFetch(`/api/reports/manager?business_day_id=${bdId}`)
        if (res.ok) {
          const data = await res.json()
          setManagers(data.managers ?? [])
          setBusinessDate(data.business_date ?? "")
        } else { setError("실장 리포트를 불러올 수 없습니다.") }
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setTabLoading(false)
    }
  }

  function handleTab(t: Tab) {
    setTab(t)
    if (businessDayId) fetchTab(t, businessDayId)
  }

  async function handleCloseDay() {
    if (!businessDayId) return
    if (!confirm("영업일을 마감하시겠습니까?")) return
    setActionLoading(true)
    try {
      const res = await apiFetch("/api/operating-days/close", {
        method: "POST",
        body: JSON.stringify({ business_day_id: businessDayId }),
      })
      if (res.ok) {
        setDayStatus("closed")
        setError("")
      } else {
        const data = await res.json()
        setError(data.message || "마감 실패")
      }
    } catch { setError("서버 오류") }
    finally { setActionLoading(false) }
  }

  async function handleReopenDay() {
    if (!businessDayId) return
    const reason = prompt("재개 사유를 입력하세요:")
    if (!reason || reason.trim().length < 2) { setError("사유를 입력해야 합니다."); return }
    setActionLoading(true)
    try {
      const res = await apiFetch("/api/operating-days/reopen", {
        method: "POST",
        body: JSON.stringify({ business_day_id: businessDayId, reason }),
      })
      if (res.ok) {
        setDayStatus("open")
        setError("")
      } else {
        const data = await res.json()
        setError(data.message || "재개 실패")
      }
    } catch { setError("서버 오류") }
    finally { setActionLoading(false) }
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
            onClick={() => router.push("/counter")}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">일일 리포트</span>
          <button
            onClick={() => router.push("/reports/period")}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25"
          >
            기간 리포트 →
          </button>
          <div className="text-xs text-slate-400">{businessDate || "—"}</div>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-white/10">
          {([["daily", "일일"], ["hostess", "스태프"], ["manager", "실장"]] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleTab(key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === key ? "text-cyan-400 border-b-2 border-cyan-400" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 영업일 없음 */}
        {!businessDayId && (
          <div className="px-4 py-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📊</div>
              <p className="text-slate-500 text-sm">오늘의 영업일이 없습니다.</p>
            </div>
          </div>
        )}

        {businessDayId && tabLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-cyan-400 text-sm">로딩 중...</div>
          </div>
        )}

        {/* 일일 탭 */}
        {businessDayId && !tabLoading && tab === "daily" && (
          <div className="px-4 py-4 space-y-3">
            {totals ? (
              <>
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">영업 상태</div>
                      <div className={`mt-1 text-sm font-semibold ${dayStatus === "open" ? "text-emerald-300" : "text-slate-400"}`}>
                        {dayStatus === "open" ? "영업 중" : "마감됨"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">세션 수</div>
                      <div className="mt-1 text-2xl font-semibold text-cyan-300">{totals.session_count}</div>
                    </div>
                  </div>
                  {role === "owner" && (
                    <div className="flex gap-2 mt-3">
                      {dayStatus === "open" ? (
                        <button onClick={handleCloseDay} disabled={actionLoading} className="flex-1 h-9 rounded-xl bg-red-500/20 text-red-300 text-xs font-medium hover:bg-red-500/30 disabled:opacity-50">
                          {actionLoading ? "처리 중..." : "영업일 마감"}
                        </button>
                      ) : (
                        <button onClick={handleReopenDay} disabled={actionLoading} className="flex-1 h-9 rounded-xl bg-amber-500/20 text-amber-300 text-xs font-medium hover:bg-amber-500/30 disabled:opacity-50">
                          {actionLoading ? "처리 중..." : "영업일 재개"}
                        </button>
                      )}
                      <button onClick={() => router.push("/audit")} className="h-9 px-4 rounded-xl bg-white/10 text-slate-300 text-xs font-medium hover:bg-white/20">
                        감사 로그
                      </button>
                    </div>
                  )}
                </div>
                {/* 2026-04-25: 총매출 카드 클릭 → 세부 내역 drill-down.
                    양주 목표는 상시 노출. 스태프/실장 개별 지급액은 비노출 유지. */}
                <button
                  type="button"
                  onClick={() => setBreakdownOpen(o => !o)}
                  className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                    breakdownOpen
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">총 매출</div>
                      <div className="text-2xl font-bold text-emerald-300 mt-0.5">
                        ₩{(totals.gross_total ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <span className="text-xs text-emerald-300">
                      {breakdownOpen ? "세부 닫기 ▲" : "세부 보기 ▼"}
                    </span>
                  </div>
                </button>

                <RevenueBreakdown businessDayId={businessDayId} open={breakdownOpen} />

                {/* 양주 목표 (owner 전용 페이지라 항상 노출) */}
                <div className="pt-2">
                  <div className="text-xs text-slate-500 mb-2 px-1">📈 양주 매출 목표 (월간)</div>
                  <LiquorTarget />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "TC", value: totals.tc_total },
                    { label: "실장 정산", value: totals.manager_total },
                    { label: "스태프 정산", value: totals.hostess_total },
                    { label: "마진", value: totals.margin_total },
                    { label: "주문 합계", value: totals.order_total },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-xs text-slate-500">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-200">₩{(item.value ?? 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : !error && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">일일 리포트 데이터가 없습니다.</p>
              </div>
            )}
          </div>
        )}

        {/* 스태프 탭 */}
        {businessDayId && !tabLoading && tab === "hostess" && (
          <div className="px-4 py-4 space-y-2">
            {hostesses.length === 0 && !error && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">스태프 리포트 데이터가 없습니다.</p>
              </div>
            )}
            {hostesses.map((h) => (
              <div key={h.membership_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-purple-500/20 flex items-center justify-center text-sm text-purple-300">
                      {(h.name || "?").slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{h.name}{h.stage_name ? ` (${h.stage_name})` : ""}</div>
                      <div className="text-xs text-slate-500">{h.total_sessions}건 · ₩{(h.total_price ?? 0).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">정산</div>
                    <div className="text-sm font-semibold text-emerald-300">₩{(h.total_payout ?? 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 실장 탭 */}
        {businessDayId && !tabLoading && tab === "manager" && (
          <div className="px-4 py-4 space-y-3">
            {managers.length === 0 && !error && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">실장 리포트 데이터가 없습니다.</p>
              </div>
            )}
            {managers.map((m) => (
              <div key={m.manager_membership_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{m.name}{m.nickname ? ` (${m.nickname})` : ""}</div>
                    <div className="text-xs text-slate-500">{m.manager_sessions}건 · 담당 {m.assigned_hostess_count}명</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">정산</div>
                    <div className="text-sm font-semibold text-cyan-300">₩{(m.manager_total_payout ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                {m.hostess_details.length > 0 && (
                  <div className="border-t border-white/5 pt-2 space-y-1">
                    <div className="text-xs text-slate-500">담당 스태프</div>
                    {m.hostess_details.map((hd) => (
                      <div key={hd.membership_id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{hd.name} ({hd.sessions}건)</span>
                        <span className="text-slate-400">₩{(hd.total_payout ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
