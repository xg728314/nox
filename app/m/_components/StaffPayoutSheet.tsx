"use client"
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../_hooks/useApi"
import { cn } from "../_lib/cn"

/**
 * R-staff-payout-sheet (2026-06-26): 식구별 정산 처리 시트.
 *
 *   상단: 식구명 / 오늘 매출 / 식구 지급액 / 타임 수
 *   섹션 1 (상태): 미지급 / ✓ 정산완료 / 📦 보관 — 3-way 토글
 *   섹션 2 (팁): 받은 팁 + 팁 보관 분리 입력
 *   섹션 3 (보관): 정산금 보관 금액
 *   섹션 4 (지급 방식): 현금 / 계좌 (paid 시만)
 *   섹션 5 (메모): optional
 */

type State = {
  status: "pending" | "paid" | "held"
  base_amount: number
  tip_amount: number
  tip_held_amount: number
  held_amount: number
  paid_amount: number
  paid_method: "cash" | "account" | null
  paid_at: string | null
  memo: string | null
  updated_at: string | null
}

type GetResp = {
  state: State | null
  today_gross: number
  today_hostess_payout: number
  today_count: number
}

export function StaffPayoutSheet({
  open,
  onClose,
  hostessId,
  hostessName,
}: {
  open: boolean
  onClose: () => void
  hostessId: string
  hostessName: string
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<GetResp | null>(null)
  const [status, setStatus] = useState<"pending" | "paid" | "held">("pending")
  const [tip, setTip] = useState(0)
  const [tipHeld, setTipHeld] = useState(0)
  const [held, setHeld] = useState(0)
  const [method, setMethod] = useState<"cash" | "account">("cash")
  const [memo, setMemo] = useState("")
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!open || !hostessId) return
    let cancel = false
    setLoading(true)
    apiFetch(`/api/manager/staff-payout/${encodeURIComponent(hostessId)}`)
      .then((r) => r.json())
      .then((j: GetResp) => {
        if (cancel) return
        setData(j)
        const s = j.state
        setStatus(s?.status ?? "pending")
        setTip(s?.tip_amount ?? 0)
        setTipHeld(s?.tip_held_amount ?? 0)
        setHeld(s?.held_amount ?? 0)
        setMethod((s?.paid_method as "cash" | "account") ?? "cash")
        setMemo(s?.memo ?? "")
        setDirty(false)
      })
      .catch(() => toast("불러오기 실패", "error"))
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [open, hostessId, toast])

  async function save() {
    if (busy) return
    setBusy(true)
    haptic([10, 20, 10])
    try {
      const computedPaid =
        status === "paid"
          ? (data?.today_hostess_payout ?? 0) + tip - held - tipHeld
          : 0
      const res = await apiFetch(`/api/manager/staff-payout/${encodeURIComponent(hostessId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          tip_amount: tip,
          tip_held_amount: tipHeld,
          held_amount: held,
          paid_amount: Math.max(0, computedPaid),
          paid_method: method,
          memo,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      toast(status === "paid" ? "정산 완료" : status === "held" ? "보관 처리됨" : "저장됨", "success")
      invalidateApi("/api/manager/settlement/summary")
      invalidateApi(`/api/manager/staff-payout/${hostessId}`)
      onClose()
    } catch (e) {
      toast(`저장 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const grossWon = (data?.today_gross ?? 0) / 10000
  const hPayWon = (data?.today_hostess_payout ?? 0) / 10000
  const count = data?.today_count ?? 0
  const finalPayWon = (((data?.today_hostess_payout ?? 0) + tip - held - tipHeld) / 10000)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${hostessName} 정산`}
      desc={loading ? "로딩 중..." : `${count}타임 · 매출 ${grossWon.toFixed(0)}만 · 식구 지급 ${hPayWon.toFixed(0)}만`}
    >
      <div className="space-y-4">
        {/* 상태 토글 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">정산 상태</div>
          <div className="grid grid-cols-3 gap-2">
            <StatusBtn
              label="미지급"
              icon="⏳"
              active={status === "pending"}
              onClick={() => { setStatus("pending"); setDirty(true) }}
            />
            <StatusBtn
              label="정산완료"
              icon="✓"
              active={status === "paid"}
              accent="green"
              onClick={() => { setStatus("paid"); setDirty(true) }}
            />
            <StatusBtn
              label="보관"
              icon="📦"
              active={status === "held"}
              accent="amber"
              onClick={() => { setStatus("held"); setDirty(true) }}
            />
          </div>
        </div>

        {/* 팁 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">팁</div>
          <div className="bg-white rounded-xl border border-[#D8D2C8] p-3 space-y-2.5">
            <Field
              label="오늘 받은 팁"
              value={tip}
              onChange={(v) => { setTip(v); setDirty(true) }}
              hint="식구 지급에 더해서 정산"
            />
            <Field
              label="팁 보관"
              value={tipHeld}
              onChange={(v) => { setTipHeld(v); setDirty(true) }}
              hint="이번에 안 주고 매장에 보관"
            />
          </div>
        </div>

        {/* 정산금 보관 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">정산금 보관</div>
          <div className="bg-white rounded-xl border border-[#D8D2C8] p-3">
            <Field
              label="보관 금액"
              value={held}
              onChange={(v) => { setHeld(v); setDirty(true) }}
              hint="식구가 나중에 받아갈 금액 (매장 보관)"
            />
          </div>
        </div>

        {/* 지급 방식 — paid 일 때만 의미 있음 */}
        {status === "paid" && (
          <div>
            <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">지급 방식</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setMethod("cash"); setDirty(true) }}
                className={cn(
                  "rounded-xl py-2.5 text-[12px] font-extrabold border-2",
                  method === "cash"
                    ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                    : "bg-white border-[#D8D2C8] text-[#7A746A]",
                )}
              >
                💵 현금
              </button>
              <button
                type="button"
                onClick={() => { setMethod("account"); setDirty(true) }}
                className={cn(
                  "rounded-xl py-2.5 text-[12px] font-extrabold border-2",
                  method === "account"
                    ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                    : "bg-white border-[#D8D2C8] text-[#7A746A]",
                )}
              >
                💳 계좌
              </button>
            </div>
          </div>
        )}

        {/* 최종 지급액 계산 */}
        <div className="bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] rounded-xl p-3 border-2 border-[#C49B61]/30">
          <div className="text-[10px] font-bold text-[#7A746A] mb-1">
            식구 {hPayWon.toFixed(0)}만 + 팁 {(tip / 10000).toFixed(tip % 10000 === 0 ? 0 : 1)}만
            − 보관 {(held / 10000).toFixed(held % 10000 === 0 ? 0 : 1)}만
            − 팁 보관 {(tipHeld / 10000).toFixed(tipHeld % 10000 === 0 ? 0 : 1)}만
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-bold text-[#7A746A]">실제 지급액</span>
            <span className="text-[20px] font-extrabold text-[#A87D45]">
              {finalPayWon.toFixed(finalPayWon % 1 === 0 ? 0 : 1)}만원
            </span>
          </div>
        </div>

        {/* 메모 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">메모 (선택)</div>
          <textarea
            value={memo}
            onChange={(e) => { setMemo(e.target.value); setDirty(true) }}
            rows={2}
            placeholder="예: 다음주 가져가기로 함"
            className="w-full bg-white border border-[#D8D2C8] rounded-xl px-3 py-2 text-[12px] font-semibold outline-none focus:border-[#C49B61] resize-none"
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy || loading}
          className={cn(
            "w-full rounded-2xl py-3.5 text-[14px] font-extrabold transition-all",
            dirty && !loading
              ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white shadow-md"
              : "bg-[#EFEBE3] text-[#A09A8E]",
          )}
        >
          {busy ? "저장 중..." : dirty ? "✓ 저장" : "변경사항 없음"}
        </button>
      </div>
    </Sheet>
  )
}

function StatusBtn({ label, icon, active, accent, onClick }: {
  label: string
  icon: string
  active: boolean
  accent?: "green" | "amber"
  onClick: () => void
}) {
  const activeBg = accent === "green"
    ? "bg-gradient-to-br from-green-500 to-green-600 text-white border-transparent"
    : accent === "amber"
      ? "bg-gradient-to-br from-amber-500 to-amber-600 text-white border-transparent"
      : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl py-3 flex flex-col items-center gap-0.5 border-2 transition-all",
        active ? activeBg : "bg-white border-[#D8D2C8] text-[#7A746A]",
      )}
    >
      <span className="text-[18px] leading-none">{icon}</span>
      <span className="text-[11px] font-extrabold">{label}</span>
    </button>
  )
}

function Field({ label, value, onChange, hint }: {
  label: string
  value: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-[#7A746A] mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value || ""}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          placeholder="0"
          className="flex-1 bg-[#F8F4ED] border border-[#D8D2C8] rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
        />
        <span className="text-[11px] font-bold text-[#7A746A] shrink-0">
          {value > 0 ? `= ${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}만원` : "원"}
        </span>
      </div>
      {hint && <div className="text-[9px] font-semibold text-[#7A746A] mt-0.5">{hint}</div>}
    </div>
  )
}
