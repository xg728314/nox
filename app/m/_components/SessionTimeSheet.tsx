"use client"
/**
 * SessionTimeSheet — 방 세션 시작 시각 조정.
 *
 * R-session-time (2026-09-04): 시나리오
 *   - 시작 10시 · 15분 지난 방 → 새 아가씨 투입 시 남은 시간 재조정 필요
 *   - "5분 남은 방에 아가씨 들어갔을 때 손님이 연장 결정 → 5분 지우고 새로 시작"
 *
 * UI:
 *   - 현재 시작 시각 표시 (HH:MM)
 *   - ±5분 / ±1분 pill 조정 (미리보기)
 *   - [지금 재시작] 버튼 (started_at = now · 세션 첫 스타트)
 *   - [적용] → PATCH /api/sessions/[id] body { started_at }
 *
 * 참여자 entered_at 은 건드리지 않음 (개별 조정은 EditParticipantSheet 로).
 */
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

function fmtHM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function SessionTimeSheet({
  open,
  onClose,
  sessionId,
  roomLabel,
  currentStartedAt,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  roomLabel: string
  currentStartedAt: string
}) {
  const toast = useToast()
  const [offsetMin, setOffsetMin] = useState(0)
  const [useNow, setUseNow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setOffsetMin(0); setUseNow(false) }
  }, [open])

  const previewIso = useNow
    ? new Date().toISOString()
    : new Date(new Date(currentStartedAt).getTime() + offsetMin * 60_000).toISOString()

  const previewHM = fmtHM(previewIso)
  const currentHM = fmtHM(currentStartedAt)
  const changed = useNow || offsetMin !== 0

  async function apply() {
    if (busy || !changed) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ started_at: previewIso }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      toast(`${roomLabel} 시작 시각 → ${previewHM}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      onClose()
    } catch (e) {
      toast(`시각 조정 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            방 시작 시각 조정
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">
            {roomLabel}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-[#7A746A]">
            현재: {currentHM}
            {changed && (
              <span className="ml-2 text-[#A87D45]">
                → {previewHM}
                {useNow ? " (지금 재시작)" : ` (${offsetMin > 0 ? "+" : ""}${offsetMin}분)`}
              </span>
            )}
          </div>
        </div>

        {/* 지금 재시작 버튼 */}
        <button
          type="button"
          onClick={() => { setUseNow((v) => !v); setOffsetMin(0) }}
          className={cn(
            "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-3 transition-all",
            useNow
              ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
              : "border-[#D8D2C8] bg-white text-[#7A746A]",
          )}
        >
          {useNow ? "✓ 지금 재시작 선택됨" : "🔄 지금 재시작 (첫 스타트)"}
        </button>

        {/* ±조정 pill (지금 재시작 아닐 때만) */}
        {!useNow && (
          <div className="mb-3">
            <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">시각 조정</div>
            <div className="grid grid-cols-5 gap-1.5">
              {[-10, -5, 0, 5, 10].map((v) => {
                const on = offsetMin === v
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setOffsetMin(v)}
                    className={cn(
                      "rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
                      on
                        ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                        : "border-[#D8D2C8] bg-white text-[#7A746A]",
                    )}
                  >
                    {v === 0 ? "0" : v > 0 ? `+${v}` : `${v}`}
                  </button>
                )
              })}
            </div>
            <div className="text-[10px] font-bold text-[#7A746A] mt-1 text-center">
              (분 단위 · 앞으로 or 뒤로)
            </div>
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || !changed}
            className={cn(
              "rounded-xl py-3 text-[13px] font-extrabold text-white transition-all",
              busy || !changed
                ? "bg-[#D8D2C8] opacity-70"
                : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] active:scale-[0.98]",
            )}
          >
            {busy ? "적용 중..." : changed ? `✓ 적용 (${previewHM})` : "변경 없음"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
