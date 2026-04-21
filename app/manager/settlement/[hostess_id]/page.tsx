"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Participant = {
  id: string
  session_id: string
  membership_id: string
  role: string
  category: string
  time_minutes: number
  price_amount: number
  manager_payout_amount: number
  hostess_payout_amount: number
  status: string
  room_name: string | null
  session_status: string
  receipt_status: string | null
}

export default function HostessSettlementDetailPage({
  params,
}: {
  params: Promise<{ hostess_id: string }>
}) {
  const { hostess_id } = use(params)
  const router = useRouter()
  const [hostessName, setHostessName] = useState("")
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      // 1. 정산 요약에서 business_day_id 가져오기
      const summaryRes = await apiFetch("/api/manager/settlement/summary")
      if (!summaryRes.ok) {
        setError("정산 데이터를 불러올 수 없습니다.")
        return
      }
      const summaryData = await summaryRes.json()
      const businessDayId = summaryData.business_day_id
      if (!businessDayId) {
        setError("영업일이 없습니다.")
        return
      }

      // 2. 해당 스태프의 세션별 참여 내역 조회 (이름도 여기서 가져옴)
      const detailRes = await apiFetch(
        `/api/manager/hostesses/${hostess_id}/sessions?business_day_id=${businessDayId}`,
      )
      if (detailRes.ok) {
        const detailData = await detailRes.json()
        setHostessName(detailData.hostess_name || "")
        setParticipants(detailData.participants ?? [])
      } else {
        setError("세션 내역을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleDeductionChange(participantId: string, deduction: number) {
    setSaving(participantId)
    setSuccessMsg("")
    try {
      const res = await apiFetch(`/api/sessions/participants/${participantId}`, {
        method: "PATCH",
        body: JSON.stringify({ manager_deduction: deduction }),
      })

      if (res.ok) {
        const data = await res.json()
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === participantId
              ? {
                  ...p,
                  manager_payout_amount: data.manager_deduction,
                  hostess_payout_amount: data.hostess_payout,
                }
              : p
          )
        )
        setSuccessMsg("저장 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
      } else {
        const errData = await res.json()
        setError(errData.message || "수정 실패")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setSaving(null)
    }
  }

  async function handleFinalize(sessionId: string) {
    // 먼저 정산 생성 (draft) → 그 다음 finalize
    setFinalizing(sessionId)
    setSuccessMsg("")
    try {
      // Step 1: 정산 생성/재계산
      const settlementRes = await apiFetch("/api/sessions/settlement", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })

      if (!settlementRes.ok) {
        const errData = await settlementRes.json()
        if (errData.error !== "ALREADY_FINALIZED") {
          // ALREADY_FINALIZED가 아닌 경우만 에러 처리
          setError(errData.message || "정산 생성 실패")
          return
        }
      }

      // Step 2: 확정
      const finalizeRes = await apiFetch("/api/sessions/settlement/finalize", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })

      if (finalizeRes.ok) {
        setParticipants((prev) =>
          prev.map((p) =>
            p.session_id === sessionId ? { ...p, receipt_status: "finalized" } : p
          )
        )
        setSuccessMsg("정산 확정 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
      } else {
        const errData = await finalizeRes.json()
        setError(errData.message || "확정 실패")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setFinalizing(null)
    }
  }

  function formatAmount(amount: number): string {
    if (amount >= 10000) {
      const man = Math.floor(amount / 10000)
      const remainder = amount % 10000
      if (remainder === 0) return `${man}만`
      return `${man}만${remainder.toLocaleString()}`
    }
    return amount.toLocaleString() + "원"
  }

  // 세션별로 그룹핑
  const sessionGroups = participants.reduce<
    Record<string, { participants: Participant[]; room_name: string | null; session_status: string; receipt_status: string | null }>
  >((acc, p) => {
    if (!acc[p.session_id]) {
      acc[p.session_id] = {
        participants: [],
        room_name: p.room_name,
        session_status: p.session_status,
        receipt_status: p.receipt_status,
      }
    }
    acc[p.session_id].participants.push(p)
    return acc
  }, {})

  const DEDUCTION_OPTIONS = [
    { value: 0, label: "0원" },
    { value: 5000, label: "5천원" },
    { value: 10000, label: "1만원" },
  ]

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
            onClick={() => router.push("/manager/settlement")}
            className="text-cyan-400 text-sm"
          >
            ← 정산 목록
          </button>
          <span className="font-semibold">
            {hostessName || "스태프"} 정산
          </span>
          <div className="w-16" />
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">닫기</button>
          </div>
        )}

        {/* 성공 메시지 */}
        {successMsg && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {successMsg}
          </div>
        )}

        {/* 세션별 카드 */}
        <div className="px-4 py-4 space-y-4">
          {Object.keys(sessionGroups).length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">이 스태프의 세션 내역이 없습니다.</p>
            </div>
          )}

          {Object.entries(sessionGroups).map(([sessionId, group]) => {
            const isFinalized = group.receipt_status === "finalized"
            const hostessParticipants = group.participants.filter((p) => p.role === "hostess")

            return (
              <div
                key={sessionId}
                className={`rounded-2xl border p-4 ${
                  isFinalized
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                {/* 세션 헤더 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-300">
                      {group.room_name || "방"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      isFinalized
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300"
                    }`}>
                      {isFinalized ? "확정" : "대기"}
                    </span>
                  </div>
                </div>

                {/* 참여자별 상세 */}
                {hostessParticipants.map((p) => (
                  <div key={p.id} className="mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    {/* 정보 행 */}
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-2">
                      <div>
                        <span className="block text-slate-500">종목</span>
                        <span className="text-white">{p.category}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">시간</span>
                        <span className="text-white">{p.time_minutes}분</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">단가</span>
                        <span className="text-white">{formatAmount(p.price_amount)}</span>
                      </div>
                    </div>

                    {/* 실장수익 선택 */}
                    <div className="mt-3">
                      <div className="text-xs text-slate-500 mb-2">실장수익</div>
                      <div className="flex gap-2">
                        {DEDUCTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            disabled={isFinalized || saving === p.id}
                            onClick={() => handleDeductionChange(p.id, opt.value)}
                            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                              p.manager_payout_amount === opt.value
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                : isFinalized
                                  ? "bg-white/5 text-slate-600 border border-white/5 cursor-not-allowed"
                                  : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                            }`}
                          >
                            {saving === p.id ? "..." : opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 스태프 지급액 표시 */}
                    <div className="mt-3 flex justify-between items-center text-sm">
                      <span className="text-slate-400">스태프 지급</span>
                      <span className="text-cyan-300 font-semibold">
                        {formatAmount(p.hostess_payout_amount)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* 확정 버튼 */}
                {!isFinalized && group.session_status === "closed" && (
                  <button
                    onClick={() => handleFinalize(sessionId)}
                    disabled={finalizing === sessionId}
                    className="mt-4 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all disabled:opacity-50"
                  >
                    {finalizing === sessionId ? "확정 처리 중..." : "정산 확정"}
                  </button>
                )}

                {isFinalized && (
                  <div className="mt-3 text-center text-xs text-emerald-400/60">
                    정산이 확정되었습니다
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
