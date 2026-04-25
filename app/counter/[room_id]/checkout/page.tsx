"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Participant = {
  id: string
  role: string
  status: string
  membership_id: string
  category: string | null
  time_minutes: number | null
  price_amount: number | null
  name: string | null
}

type EditableParticipant = Participant & {
  edited_time: number
  edited_price: number
}

// 종목별 단가 테이블 (로컬 계산용)
// 퍼블릭: 90/130k, 45/70k, 15/30k
// 셔츠:   60/140k, 30/70k, 15/30k
// 하퍼:   60/120k, 30/60k, 15/30k
const PRICE_TABLE: Record<string, Record<number, number>> = {
  퍼블릭: { 90: 130000, 45: 70000, 15: 30000 },
  셔츠:   { 60: 140000, 30: 70000, 15: 30000 },
  하퍼:   { 60: 120000, 30: 60000, 15: 30000 },
}

const TIME_OPTIONS = [15, 30, 45, 60, 90]

function fmtWon(n: number) {
  return "₩" + n.toLocaleString()
}

function calcPrice(category: string | null, timeMinutes: number): number {
  if (!category) return 0
  const row = PRICE_TABLE[category]
  if (!row) return 0
  return row[timeMinutes] ?? 0
}

export default function CheckoutPage() {
  const router = useRouter()
  const params = useParams()
  const roomId = params.room_id as string

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<EditableParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    ;(async () => {
      try {
        const res = await apiFetch(`/api/rooms/${roomId}/participants`)
        const data = await res.json()
        if (!res.ok) {
          setError(data.message || "참여자 조회 실패")
          return
        }

        setSessionId(data.session_id)

        // 스태프(hostess)만 필터, 편집용 필드 추가
        const hostesses: EditableParticipant[] = (data.participants || [])
          .filter((p: Participant) => p.role === "hostess")
          .map((p: Participant) => ({
            ...p,
            edited_time: p.time_minutes ?? 0,
            edited_price: p.price_amount ?? 0,
          }))

        setParticipants(hostesses)
      } catch {
        setError("요청 오류")
      } finally {
        setLoading(false)
      }
    })()
  }, [roomId, router])

  function handleTimeChange(participantId: string, newTime: number) {
    setParticipants(prev =>
      prev.map(p => {
        if (p.id !== participantId) return p
        const newPrice = calcPrice(p.category, newTime)
        return { ...p, edited_time: newTime, edited_price: newPrice }
      })
    )
  }

  const totalAmount = participants.reduce((sum, p) => sum + p.edited_price, 0)

  async function handleFinalize() {
    if (!sessionId) {
      setError("세션 정보 없음")
      return
    }
    setSubmitting(true)
    setError("")

    try {
      // 1. 시간이 변경된 스태프만 필터링 후 PATCH
      const changed = participants.filter(
        p => p.edited_time !== (p.time_minutes ?? 0) || p.edited_price !== (p.price_amount ?? 0)
      )
      for (const p of changed) {
        const patchRes = await apiFetch(`/api/sessions/participants/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            time_minutes: p.edited_time,
            price_amount: p.edited_price,
          }),
        })
        if (!patchRes.ok) {
          const d = await patchRes.json()
          setError(d.message || `${p.name || ""} 수정 실패`)
          return
        }
      }

      const checkoutRes = await apiFetch("/api/sessions/checkout", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!checkoutRes.ok) {
        const d = await checkoutRes.json()
        setError(d.message || "체크아웃 실패")
        return
      }

      const settlementRes = await apiFetch("/api/sessions/settlement", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!settlementRes.ok) {
        const d = await settlementRes.json()
        setError(d.message || "정산 생성 실패")
        return
      }

      router.push("/counter")
    } catch {
      setError("요청 오류")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,173,255,0.08),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) router.back()
              else router.push("/counter")
            }}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">퇴실 정산</span>
          <div />
        </div>

        {error && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 py-4 pb-40">
          {loading ? (
            <div className="p-10 text-center text-cyan-400 text-sm animate-pulse">불러오는 중...</div>
          ) : participants.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">등록된 스태프가 없습니다.</div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold mb-2">스태프 정산 내역</h2>
              {participants.map(p => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-semibold text-base">{p.name || "(이름 없음)"}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {p.category || "-"}
                        {p.time_minutes !== null && (
                          <span className="ml-2 text-slate-500">
                            기존 {p.time_minutes}분 · {fmtWon(p.price_amount ?? 0)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-300">{fmtWon(p.edited_price)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">시간</span>
                    <select
                      value={p.edited_time}
                      onChange={(e) => handleTimeChange(p.id, Number(e.target.value))}
                      className="flex-1 rounded-xl border border-white/10 bg-[#030814] px-3 py-2 text-sm text-white focus:border-cyan-500/40 outline-none"
                    >
                      {TIME_OPTIONS.map(t => (
                        <option key={t} value={t}>{t}분</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 하단 고정 영역: 총액 + 확정 버튼 */}
        {!loading && participants.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#030814]/95 backdrop-blur border-t border-white/10 px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-400">총 금액</span>
              <span className="text-2xl font-bold text-emerald-300">{fmtWon(totalAmount)}</span>
            </div>
            <button
              onClick={handleFinalize}
              disabled={submitting}
              className="w-full h-14 rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold disabled:opacity-50 shadow-[0_8px_30px_rgba(37,99,235,0.35)]"
            >
              {submitting ? "처리 중..." : "정산 확정"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
