"use client"
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../_hooks/useApi"
import { cn } from "../_lib/cn"

/**
 * R-edit-participant (2026-06-26): 참여자 시간/금액 수정 시트.
 *
 *   타매장 식구 row 우측 ✏️ 클릭 → 시트 열림.
 *   - 시간 (완티/반티/차3) → PATCH action: wanti/banti/cha3
 *   - 실장 공제 (0/5천/1만/직접입력) → PATCH manager_deduction
 *
 *   끝난(finished) row 도 수정 가능 — finalize 전이면 비즈니스 OK.
 */

type Props = {
  open: boolean
  onClose: () => void
  participantId: string
  hostessName: string
  category: string | null
  timeMinutes: number | null
  priceAmount: number
  managerPayout: number
}

type TimeKey = "wanti" | "banti" | "cha3"

const TIME_LABEL: Record<TimeKey, string> = {
  wanti: "완티 (기본)",
  banti: "반티",
  cha3: "차3",
}

export function EditParticipantSheet({
  open,
  onClose,
  participantId,
  hostessName,
  category,
  timeMinutes,
  priceAmount,
  managerPayout,
}: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [deduction, setDeduction] = useState(managerPayout)
  const [customMode, setCustomMode] = useState(false)

  // 시트 열릴 때마다 deduction 초기화
  useEffect(() => {
    if (open) {
      setDeduction(managerPayout)
      setCustomMode(![0, 5000, 10000].includes(managerPayout))
    }
  }, [open, managerPayout])

  async function changeTime(key: TimeKey) {
    if (busy) return
    setBusy(true)
    haptic([10, 20, 10])
    try {
      const res = await apiFetch(
        `/api/sessions/participants/${encodeURIComponent(participantId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: key }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`${TIME_LABEL[key]} 적용`, "success")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
    } catch (e) {
      toast(`변경 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  async function saveDeduction() {
    if (busy) return
    setBusy(true)
    haptic([10, 20, 10])
    try {
      const d = Math.max(0, Math.min(100000, Math.floor(deduction)))
      const res = await apiFetch(
        `/api/sessions/participants/${encodeURIComponent(participantId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manager_deduction: d }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`실장 공제 ${(d / 1000).toFixed(0)}천원 적용`, "success")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
    } catch (e) {
      toast(`변경 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const hostessPay = priceAmount - deduction

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${hostessName} 수정`}
      desc={`${category ?? "—"} · 현재 ${timeMinutes ?? 0}분 · ${(priceAmount / 10000).toFixed(0)}만원`}
    >
      <div className="space-y-4">
        {/* 시간 변경 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">
            시간 변경
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["wanti", "banti", "cha3"] as TimeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => changeTime(k)}
                className="rounded-xl py-3 text-[12px] font-extrabold border-2 bg-white border-[#D8D2C8] text-[#2D2B26] active:bg-[#FAF5EC] disabled:opacity-40"
              >
                {TIME_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {/* 실장 공제 */}
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">
            실장 공제 (1타임당)
          </div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {[0, 5000, 10000].map((v) => {
              const active = !customMode && deduction === v
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setDeduction(v); setCustomMode(false) }}
                  className={cn(
                    "rounded-xl py-2.5 text-[12px] font-extrabold border-2",
                    active
                      ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                      : "bg-white border-[#D8D2C8] text-[#7A746A]",
                  )}
                >
                  {v === 0 ? "0원" : `${(v / 1000).toFixed(0)}천`}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className={cn(
                "rounded-xl py-2.5 text-[11px] font-extrabold border-2",
                customMode
                  ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                  : "bg-white border-[#D8D2C8] text-[#7A746A]",
              )}
            >
              직접
            </button>
          </div>
          {customMode && (
            <input
              type="number"
              value={deduction}
              onChange={(e) => setDeduction(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
              inputMode="numeric"
              placeholder="공제 금액 (원)"
              className="w-full bg-[#F8F4ED] border border-[#D8D2C8] rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
            />
          )}
          <div className="text-[10px] font-bold text-[#7A746A] mt-2">
            매출 {(priceAmount / 10000).toFixed(0)}만 − 공제 {(deduction / 10000).toFixed(deduction % 10000 === 0 ? 0 : 1)}만
            <span className="text-[#A87D45] ml-1">= 식구 지급 {(hostessPay / 10000).toFixed(hostessPay % 10000 === 0 ? 0 : 1)}만원</span>
          </div>
          <button
            type="button"
            onClick={saveDeduction}
            disabled={busy}
            className="w-full mt-2 bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
          >
            {busy ? "저장 중..." : "✓ 공제 적용"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
