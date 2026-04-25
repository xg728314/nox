"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { mapErrorMessage } from "./errorMessages"

/**
 * ManagerPrepaymentModal — STEP-043.
 *
 * Opens from the settlement-tree Level 2 row so the operator can record
 * a prepayment against an individual counterpart-store manager. The
 * modal shows the running manager / store balance and lists existing
 * prepayment rows so the operator can sanity-check before saving.
 *
 * POST fires /api/payouts/manager-prepayment, which re-derives totals
 * server-side from session_participants and rejects overpayments
 * (409 MANAGER_OVERPAY or STORE_OVERPAY). The caller must refetch
 * Level 1/2 after `onSaved` so the UI reflects the new remaining.
 *
 * Non-destructive: each POST creates a new ledger row. No overwrite.
 */

const won = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("ko-KR") + "원"

type PrepaymentRow = {
  id: string
  amount: number
  memo: string | null
  business_day_id: string | null
  created_at: string
}

type Props = {
  open: boolean
  counterpartStoreUuid: string
  counterpartStoreName: string
  managerMembershipId: string
  managerName: string
  managerTotal: number
  storeTotal: number
  storePrepaid: number
  businessDayId?: string | null
  onClose: () => void
  onSaved: () => void
}

export default function ManagerPrepaymentModal({
  open,
  counterpartStoreUuid,
  counterpartStoreName,
  managerMembershipId,
  managerName,
  managerTotal,
  storeTotal,
  storePrepaid,
  businessDayId,
  onClose,
  onSaved,
}: Props) {
  const [amountStr, setAmountStr] = useState("")
  const [memo, setMemo] = useState("")
  const [rows, setRows] = useState<PrepaymentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const myPrepaidSoFar = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const managerRemaining = Math.max(0, managerTotal - myPrepaidSoFar)
  const storeRemaining = Math.max(0, storeTotal - storePrepaid)
  const maxAllowed = Math.min(managerRemaining, storeRemaining)

  const amountNum = Number(amountStr.replace(/[^0-9.-]/g, ""))
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= maxAllowed

  useEffect(() => {
    if (!open) return
    ;(async () => {
      setLoading(true)
      setError("")
      try {
        const res = await apiFetch(
          `/api/payouts/manager-prepayment` +
          `?counterpart_store_uuid=${encodeURIComponent(counterpartStoreUuid)}` +
          `&manager_membership_id=${encodeURIComponent(managerMembershipId)}`
        )
        if (res.ok) {
          const d = await res.json()
          setRows((d.prepayments ?? []) as PrepaymentRow[])
        }
      } catch { /* ignore list fetch */ }
      finally { setLoading(false) }
    })()
  }, [open, counterpartStoreUuid, managerMembershipId])

  useEffect(() => {
    if (!open) {
      setAmountStr("")
      setMemo("")
      setError("")
    }
  }, [open])

  if (!open) return null

  async function submit() {
    if (submitting) return
    setError("")
    if (!amountValid) {
      setError(`금액이 잘못되었습니다. (가능한 최대 ${won(maxAllowed)})`)
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/payouts/manager-prepayment", {
        method: "POST",
        body: JSON.stringify({
          target_store_uuid: counterpartStoreUuid,
          target_manager_membership_id: managerMembershipId,
          amount: amountNum,
          memo: memo.trim() || null,
          business_day_id: businessDayId ?? null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = typeof d?.error === "string" ? d.error : ""
        const fallback = typeof d?.message === "string" ? d.message : `저장 실패 (${res.status})`
        const msg = mapErrorMessage(code, fallback)
        setError(msg)
        return
      }
      onSaved()
      onClose()
    } catch {
      setError("네트워크 오류")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-[440px] rounded-2xl bg-[#0d1020] border border-white/10 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-base font-bold">실장 선지급</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {counterpartStoreName} · <span className="text-purple-300">{managerName}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Balance card */}
        <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 mb-3 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">실장 총 지급 예정</span>
            <span className="text-slate-200 font-semibold">{won(managerTotal)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">- 누적 선지급</span>
            <span className="text-amber-300">{won(myPrepaidSoFar)}</span>
          </div>
          <div className="flex justify-between text-[11px] pt-1.5 border-t border-white/10">
            <span className="text-slate-400 font-semibold">실장 잔액</span>
            <span className="text-emerald-300 font-bold">{won(managerRemaining)}</span>
          </div>
          <div className="flex justify-between text-[10px] pt-1 mt-1 border-t border-white/5 text-slate-500">
            <span>가게 잔액 (이 매장 전체)</span>
            <span>{won(storeRemaining)}</span>
          </div>
          <div className="text-[10px] text-slate-500 pt-1 mt-1 border-t border-white/5 leading-relaxed">
            잔액 기준: aggregate 완료 시 <span className="text-emerald-300">정산 item 잔액</span>,
            미실행 시 <span className="text-amber-300">aggregate 전 legacy 기준</span> 으로 상한이
            적용됩니다. 서버가 MANAGER_OVERPAY / STORE_OVERPAY / MANAGER_NO_ITEMS 으로 차단 가능.
          </div>
        </div>

        {/* Amount input */}
        <div className="mb-2">
          <label className="block text-[11px] text-slate-400 mb-1">선지급 금액</label>
          <input
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
          />
          <div className="text-[10px] text-slate-500 mt-1">
            가능한 최대 {won(maxAllowed)}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] text-slate-400 mb-1">메모 (선택)</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 4/18 현금 일부 선지급"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
          />
        </div>

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Existing rows */}
        <div className="mb-3">
          <div className="text-[10px] text-slate-500 mb-1.5">이 실장 선지급 이력 ({rows.length}건)</div>
          {loading ? (
            <div className="py-3 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
          ) : rows.length === 0 ? (
            <div className="py-3 text-center text-slate-500 text-xs border border-dashed border-white/10 rounded-lg">선지급 이력 없음</div>
          ) : (
            <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
              {rows.map(r => (
                <div key={r.id} className="flex items-center justify-between text-[11px] bg-white/[0.03] rounded px-2.5 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-amber-300 font-semibold">{won(Number(r.amount) || 0)}</div>
                    {r.memo && <div className="text-slate-500 text-[10px] truncate">{r.memo}</div>}
                  </div>
                  <div className="text-slate-600 text-[10px]">{new Date(r.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-white/5 text-slate-300 text-sm hover:bg-white/10 disabled:opacity-50"
          >취소</button>
          <button
            onClick={submit}
            disabled={submitting || !amountValid}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              amountValid
                ? "bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-white"
                : "bg-white/5 text-slate-600 cursor-not-allowed"
            } disabled:opacity-60`}
          >
            {submitting ? "저장 중..." : "선지급 저장"}
          </button>
        </div>
      </div>
    </div>
  )
}
