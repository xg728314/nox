"use client"

/**
 * CreditRegisterModal — 방 카드에서 외상 즉시 등록.
 *
 * 2026-04-25: 기존엔 /credits 페이지로 이동해야만 등록 가능 → 체크아웃
 *   플로우에서 외상 전환이 번거로움. 방 카드 "시간/연장" 바에 외상 버튼을
 *   추가하고 이 모달로 원샷 처리.
 *
 * 2개 사이드이펙트를 한 번에 처리:
 *   1. POST /api/customers    — 손님 DB 등록 (phone 중복은 서버가 판단)
 *   2. POST /api/credits      — 외상 레코드 생성 (room + manager + customer)
 *
 * 선행 조건:
 *   - 방에 active session 이 있어야 함 (session_id / manager_membership_id
 *     가 모두 필요. 세션 없으면 외상 등록 불가 — 체크인 먼저 하라는
 *     안내 표시).
 *   - manager_membership_id 가 세션에 지정돼야 함 (실장 미지정이면 모달이
 *     에러 상태로 표시).
 *
 * 입력:
 *   - 손님 이름 (필수)
 *   - 손님 연락처 (선택, 중복 검사 참고용)
 *   - 금액 (기본값 = grandTotal)
 *   - 메모 (선택)
 *
 * 금액 기본값 철학: 이 시점에 현재 세션의 총액 (스태프 타임 + 주문) 을
 *   외상 금액으로 자동 채운다. 부분 외상이면 사용자가 수정.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { captureException } from "@/lib/telemetry/captureException"

type Props = {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  roomUuid: string
  sessionId: string | null
  managerMembershipId: string | null
  defaultAmount: number
  /** 초기 표시용. 손님 정보가 세션에 이미 있으면 prefill. */
  initialCustomerName?: string
  initialCustomerPhone?: string
}

export default function CreditRegisterModal({
  open,
  onClose,
  onSuccess,
  roomUuid,
  sessionId,
  managerMembershipId,
  defaultAmount,
  initialCustomerName,
  initialCustomerPhone,
}: Props) {
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [amount, setAmount] = useState("")
  const [memo, setMemo] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (!open) return
    setCustomerName(initialCustomerName ?? "")
    setCustomerPhone(initialCustomerPhone ?? "")
    setAmount(defaultAmount > 0 ? String(defaultAmount) : "")
    setMemo("")
    setError("")
    setSuccess("")
  }, [open, defaultAmount, initialCustomerName, initialCustomerPhone])

  if (!open) return null

  async function handleSubmit() {
    if (busy) return
    setError("")

    const name = customerName.trim()
    if (!name) {
      setError("손님 이름은 필수입니다.")
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("금액은 0보다 커야 합니다.")
      return
    }
    if (!sessionId) {
      setError("진행 중 세션이 없습니다. 체크인 먼저 해주세요.")
      return
    }
    if (!managerMembershipId) {
      setError(
        "세션에 담당 실장이 지정되지 않았습니다. 실장 지정 후 외상 등록 가능.",
      )
      return
    }

    setBusy(true)
    try {
      // 1. 손님 DB 등록. 실패해도 외상 등록은 진행 (이름만 있어도 외상은 가능).
      try {
        await apiFetch("/api/customers", {
          method: "POST",
          body: JSON.stringify({
            name,
            phone: customerPhone.trim() || undefined,
            memo: memo.trim() || undefined,
          }),
        })
      } catch (e) {
        // 고객 DB 등록 실패는 외상 플로우를 막지 않음. 로그만 남김.
        captureException(e, { tag: "credit_customer_register_soft_fail" })
      }

      // 2. 외상 등록 (필수).
      const res = await apiFetch("/api/credits", {
        method: "POST",
        body: JSON.stringify({
          room_uuid: roomUuid,
          manager_membership_id: managerMembershipId,
          customer_name: name,
          customer_phone: customerPhone.trim() || undefined,
          amount: amt,
          memo: memo.trim() || undefined,
          session_id: sessionId,
        }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        setError(data.message || "외상 등록 실패")
        setBusy(false)
        return
      }

      setSuccess("외상 등록 완료")
      setBusy(false)
      if (onSuccess) onSuccess()
      setTimeout(() => {
        onClose()
      }, 800)
    } catch (e) {
      captureException(e, {
        tag: "credit_register",
        extra: { roomUuid, sessionId },
      })
      setError("네트워크 오류. 다시 시도해주세요.")
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-[#0b0e1c] border-t md:border border-white/10 rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">외상 등록</h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-500 hover:text-slate-300 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              손님 이름 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={busy}
              placeholder="예: 김길동"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/40"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              손님 연락처 <span className="text-slate-600">(선택)</span>
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              disabled={busy}
              placeholder="010-0000-0000"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/40"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              금액 (원) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              placeholder="0"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/40"
            />
            {defaultAmount > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">
                현재 세션 합계 ₩{defaultAmount.toLocaleString()} 기본값으로 채움.
                부분 외상이면 수정.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              메모 <span className="text-slate-600">(선택)</span>
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="예: 다음 방문 시 회수"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/40 resize-none"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs">
              {error}
            </div>
          )}
          {success && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs">
              {success}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 text-sm disabled:opacity-50"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy || !customerName.trim() || !amount}
              className="flex-1 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm font-semibold disabled:opacity-40"
            >
              {busy ? "등록 중..." : "외상 등록"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
