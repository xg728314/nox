"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type PreSettlement = {
  id: string
  amount: number
  memo: string | null
  requester_name: string | null
  executor_name: string | null
  status: string
  created_at: string
}

type StaffMember = {
  membership_id: string
  name: string
  role: string
}

export default function PreSettlementPage({
  params,
}: {
  params: Promise<{ room_id: string }>
}) {
  const { room_id } = use(params)
  const router = useRouter()

  const [sessionId, setSessionId] = useState("")
  const [preSettlements, setPreSettlements] = useState<PreSettlement[]>([])
  const [totalActive, setTotalActive] = useState(0)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [amount, setAmount] = useState("")
  const [requesterId, setRequesterId] = useState("")
  const [memo, setMemo] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      // 1. 방의 active session 조회
      const roomRes = await apiFetch(`/api/rooms?room_uuid=${room_id}`)
      if (!roomRes.ok) { setError("방 정보를 불러올 수 없습니다."); return }

      const roomData = await roomRes.json()
      const rooms = roomData.rooms ?? []
      const room = rooms.find((r: { room_uuid: string }) => r.room_uuid === room_id)

      if (!room?.active_session_id) {
        setError("활성 세션이 없습니다. 선정산은 세션 진행 중에만 가능합니다.")
        setLoading(false)
        return
      }

      setSessionId(room.active_session_id)

      // 2. 기존 선정산 내역
      const psRes = await apiFetch(`/api/sessions/pre-settlement?session_id=${room.active_session_id}`)
      if (psRes.ok) {
        const psData = await psRes.json()
        setPreSettlements(psData.pre_settlements ?? [])
        setTotalActive(psData.total_active ?? 0)
      }

      // 3. 스태프 목록 (요청자 선택용)
      const staffRes = await apiFetch("/api/store/staff")
      if (staffRes.ok) {
        const staffData = await staffRes.json()
        setStaff(staffData.staff ?? [])
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sessionId) return

    if (!amount || Number(amount) <= 0) {
      setError("금액을 입력하세요.")
      return
    }
    if (!requesterId) {
      setError("요청자를 선택하세요.")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/sessions/pre-settlement", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          amount: Number(amount),
          requester_membership_id: requesterId,
          memo: memo.trim() || undefined,
        }),
      })

      if (res.ok) {
        setSuccessMsg("선정산 등록 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
        setAmount("")
        setMemo("")
        // 재조회
        const psRes = await apiFetch(`/api/sessions/pre-settlement?session_id=${sessionId}`)
        if (psRes.ok) {
          const psData = await psRes.json()
          setPreSettlements(psData.pre_settlements ?? [])
          setTotalActive(psData.total_active ?? 0)
        }
      } else {
        const data = await res.json()
        setError(data.message || "등록 실패")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setSubmitting(false)
    }
  }

  function fmt(v: number): string {
    if (v >= 10000) {
      const man = Math.floor(v / 10000)
      const rem = v % 10000
      if (rem === 0) return `${man}만원`
      return `${man}만${rem.toLocaleString()}원`
    }
    return v.toLocaleString() + "원"
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

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push(`/counter/${room_id}`)} className="text-cyan-400 text-sm">
            ← 방 상세
          </button>
          <span className="font-semibold">선정산</span>
          <div className="w-16" />
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">닫기</button>
          </div>
        )}
        {successMsg && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {successMsg}
          </div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 선정산 합계 */}
          {totalActive > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <div className="text-xs text-slate-400">선정산 합계 (미차감)</div>
              <div className="mt-1 text-2xl font-bold text-amber-300">{fmt(totalActive)}</div>
              <div className="mt-1 text-xs text-slate-500">최종 정산 시 자동 차감됩니다</div>
            </div>
          )}

          {/* 등록 폼 */}
          {sessionId && (
            <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
              <div className="text-sm font-medium text-slate-300">선정산 등록</div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">요청자 *</label>
                <select
                  value={requesterId}
                  onChange={(e) => setRequesterId(e.target.value)}
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40"
                >
                  <option value="">선택</option>
                  {staff.map((s) => (
                    <option key={s.membership_id} value={s.membership_id}>
                      {s.name} ({s.role === "owner" ? "사장" : s.role === "manager" ? "실장" : "스태프"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">금액 (원) *</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="1"
                  placeholder="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">메모</label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="사유 (선택)"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
                />
              </div>

              <div className="text-xs text-slate-500 pt-1">
                실행자: 현재 로그인 사용자 (자동 기록)
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm transition-all disabled:opacity-50"
              >
                {submitting ? "등록 중..." : "선정산 등록"}
              </button>
            </form>
          )}

          {/* 기존 내역 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">선정산 내역</span>
              <span className="text-xs text-slate-500">{preSettlements.length}건</span>
            </div>

            {preSettlements.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">선정산 내역이 없습니다.</p>
              </div>
            )}

            <div className="space-y-2">
              {preSettlements.map((ps) => (
                <div
                  key={ps.id}
                  className={`rounded-2xl border p-4 ${
                    ps.status === "active"
                      ? "border-amber-500/20 bg-amber-500/5"
                      : "border-emerald-500/20 bg-emerald-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-amber-300">{fmt(ps.amount)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      ps.status === "active"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-emerald-500/20 text-emerald-300"
                    }`}>
                      {ps.status === "active" ? "미차감" : "차감완료"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div>
                      <span className="block text-slate-500">요청자</span>
                      <span className="text-white">{ps.requester_name || "−"}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500">실행자</span>
                      <span className="text-white">{ps.executor_name || "−"}</span>
                    </div>
                  </div>

                  {ps.memo && (
                    <div className="mt-2 text-xs text-slate-500">메모: {ps.memo}</div>
                  )}

                  <div className="mt-2 text-xs text-slate-600">
                    {new Date(ps.created_at).toLocaleString("ko-KR", {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
