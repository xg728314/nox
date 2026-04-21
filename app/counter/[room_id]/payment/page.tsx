"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type PaymentMethod = "cash" | "card" | "credit" | "mixed"

export default function PaymentPage({
  params,
}: {
  params: Promise<{ room_id: string }>
}) {
  const { room_id } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // 세션/영수증 정보
  const [sessionId, setSessionId] = useState("")
  const [grossTotal, setGrossTotal] = useState(0)
  const [receiptStatus, setReceiptStatus] = useState("")
  const [existingPayment, setExistingPayment] = useState<string | null>(null)

  // 카드수수료율
  const [cardFeeRate, setCardFeeRate] = useState(0.05)

  // 결제 입력
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [cashAmount, setCashAmount] = useState(0)
  const [cardAmount, setCardAmount] = useState(0)
  const [creditAmount, setCreditAmount] = useState(0)
  const [managerCardMargin, setManagerCardMargin] = useState(0)

  // 외상 손님정보
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  // 결제 방식 변경 시 금액 자동 배분
  useEffect(() => {
    if (method === "cash") {
      setCashAmount(grossTotal)
      setCardAmount(0)
      setCreditAmount(0)
    } else if (method === "card") {
      setCashAmount(0)
      setCardAmount(grossTotal)
      setCreditAmount(0)
    } else if (method === "credit") {
      setCashAmount(0)
      setCardAmount(0)
      setCreditAmount(grossTotal)
    }
    // mixed는 수동 입력
  }, [method, grossTotal])

  async function fetchData() {
    try {
      // 1. Resolve session + gross_total from /api/rooms.
      //    After checkout, room.session is null but room.closed_session carries
      //    both the session id and the calculated gross_total (recently-closed,
      //    within 6 hours). This is the authoritative source of truth we share
      //    with the counter room page so the payment amount is consistent.
      //    The previous implementation called /api/sessions/receipt?room_uuid=…
      //    which the route does not support (it requires session_id or
      //    snapshot_id) and whose response shape did not match the flat
      //    receipt this page expected — causing sessionId to stay empty and
      //    grossTotal to stay 0.
      const roomRes = await apiFetch("/api/rooms")
      if (!roomRes.ok) { setError("방 정보를 불러올 수 없습니다."); return }

      const roomData = await roomRes.json()
      const rooms = roomData.rooms ?? []
      const room = rooms.find((r: { id: string }) => r.id === room_id)

      if (!room) {
        setError("방을 찾을 수 없습니다.")
        return
      }

      // Prefer the active session if still open; otherwise use the recently
      // closed session populated by /api/rooms after checkout.
      type SessionInfo = { id: string; status: string; gross_total: number }
      const sessionInfo: SessionInfo | null =
        (room.session as SessionInfo | null) ?? (room.closed_session as SessionInfo | null) ?? null

      if (!sessionInfo?.id) {
        setError("세션 정보를 찾을 수 없습니다. 체크아웃과 정산을 먼저 완료해주세요.")
        return
      }

      setSessionId(sessionInfo.id)
      setGrossTotal(sessionInfo.gross_total ?? 0)
      setReceiptStatus(sessionInfo.status ?? "")
      // Default cash-only payment to the full amount; the method-change effect
      // (lines 48-63) will rebalance when the user picks a different method.
      setCashAmount(sessionInfo.gross_total ?? 0)
      // existingPayment remains null — preloading prior payment state would
      // require a dedicated GET endpoint that does not exist today. If the
      // receipt is already paid, the POST-time RPC returns ALREADY_PAID and
      // the existing error path renders the controlled failure message.

      // 2. 카드수수료율
      const settingsRes = await apiFetch("/api/store/settings")
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        if (settingsData.settings?.card_fee_rate !== undefined) {
          setCardFeeRate(Number(settingsData.settings.card_fee_rate))
        }
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const cardFeeAmount = cardAmount > 0 ? Math.floor(cardAmount * cardFeeRate) : 0
  const totalPayment = cashAmount + cardAmount + creditAmount
  const isBalanced = totalPayment === grossTotal
  const needsCredit = method === "credit" || (method === "mixed" && creditAmount > 0)

  async function handleSubmit() {
    if (!sessionId) return

    if (!isBalanced) {
      setError(`결제 합계(${totalPayment.toLocaleString()})가 총액(${grossTotal.toLocaleString()})과 일치하지 않습니다.`)
      return
    }

    if (needsCredit && !customerName.trim()) {
      setError("외상 결제 시 손님 이름은 필수입니다.")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/sessions/settlement/payment", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          payment_method: method,
          cash_amount: cashAmount,
          card_amount: cardAmount,
          credit_amount: creditAmount,
          manager_card_margin: managerCardMargin,
          customer_name: needsCredit ? customerName.trim() : undefined,
          customer_phone: needsCredit ? customerPhone.trim() || undefined : undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setExistingPayment(data.payment_method)
        setSuccessMsg("결제 방식 저장 완료")
        setTimeout(() => {
          router.push(`/counter/${room_id}`)
        }, 1500)
      } else {
        const errData = await res.json()
        setError(errData.message || "결제 저장 실패")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  function fmt(amount: number): string {
    if (amount >= 10000) {
      const man = Math.floor(amount / 10000)
      const remainder = amount % 10000
      if (remainder === 0) return `${man}만원`
      return `${man}만${remainder.toLocaleString()}원`
    }
    return amount.toLocaleString() + "원"
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  const METHOD_OPTIONS: { key: PaymentMethod; label: string }[] = [
    { key: "cash", label: "현금" },
    { key: "card", label: "카드" },
    { key: "credit", label: "외상" },
    { key: "mixed", label: "혼합" },
  ]

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push(`/counter/${room_id}`)} className="text-cyan-400 text-sm">
            ← 방 상세
          </button>
          <span className="font-semibold">결제 방식</span>
          <div className="w-16" />
        </div>

        {/* 메시지 */}
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
          {/* 총액 표시 */}
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
            <div className="text-xs text-slate-400">결제 총액</div>
            <div className="mt-1 text-3xl font-bold text-cyan-300">{fmt(grossTotal)}</div>
            {existingPayment && (
              <div className="mt-2 text-xs text-slate-400">
                기존 결제: {existingPayment === "cash" ? "현금" : existingPayment === "card" ? "카드" : existingPayment === "credit" ? "외상" : "혼합"}
              </div>
            )}
          </div>

          {/* 결제 방식 선택 */}
          <div>
            <div className="text-xs text-slate-400 mb-2">결제 방식</div>
            <div className="grid grid-cols-4 gap-2">
              {METHOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setMethod(opt.key)}
                  className={`py-3 rounded-xl text-sm font-medium transition-all ${
                    method === opt.key
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                      : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 혼합 결제: 금액 분배 */}
          {method === "mixed" && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-slate-400 mb-1">금액 분배</div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">현금</label>
                <input
                  type="number"
                  value={cashAmount || ""}
                  onChange={(e) => setCashAmount(Number(e.target.value) || 0)}
                  min="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">카드</label>
                <input
                  type="number"
                  value={cardAmount || ""}
                  onChange={(e) => setCardAmount(Number(e.target.value) || 0)}
                  min="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">외상</label>
                <input
                  type="number"
                  value={creditAmount || ""}
                  onChange={(e) => setCreditAmount(Number(e.target.value) || 0)}
                  min="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40"
                />
              </div>

              {/* 합계 확인 */}
              <div className={`flex justify-between items-center text-sm pt-2 border-t border-white/5 ${
                isBalanced ? "text-emerald-400" : "text-red-400"
              }`}>
                <span>합계</span>
                <span className="font-semibold">
                  {fmt(totalPayment)} {isBalanced ? "" : `(차액: ${fmt(Math.abs(grossTotal - totalPayment))})`}
                </span>
              </div>
            </div>
          )}

          {/* 카드수수료 표시 */}
          {cardAmount > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
              <div className="text-xs text-slate-400">카드수수료</div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">수수료율</span>
                <span className="text-white">{(cardFeeRate * 100).toFixed(1)}%</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">카드결제액</span>
                <span className="text-white">{fmt(cardAmount)}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">수수료</span>
                <span className="text-amber-300 font-semibold">{fmt(cardFeeAmount)}</span>
              </div>

              {/* 실장 추가마진 */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">실장 추가마진</label>
                <input
                  type="number"
                  value={managerCardMargin || ""}
                  onChange={(e) => setManagerCardMargin(Number(e.target.value) || 0)}
                  min="0"
                  step="1000"
                  placeholder="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* 외상 손님정보 */}
          {needsCredit && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <div className="text-xs text-amber-300">외상 손님 정보</div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">손님 이름 *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="손님 이름"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">연락처</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
                />
              </div>

              <div className="flex justify-between items-center text-sm pt-2 border-t border-white/5">
                <span className="text-slate-400">외상 금액</span>
                <span className="text-amber-300 font-semibold">{fmt(creditAmount)}</span>
              </div>
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !isBalanced || grossTotal === 0}
            className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm transition-all disabled:opacity-50"
          >
            {submitting ? "저장 중..." : "결제 확정"}
          </button>
        </div>
      </div>
    </div>
  )
}
