"use client"
/**
 * SessionTimeSheet — 방 세션 시각 조정 (시간 삭제·차N 청구 · ±조정).
 *
 * R-session-time (2026-09-04): 사용자 시나리오
 *   - 진행 20분 방 · 새 아가씨 투입 or 손님 연장 시 시간 재조정
 *   - "N분 삭제 (재시작)" — 지난 시간 무료 처리 · started_at=now
 *   - "N분 → 차N 청구 (재시작)" — 짧은 시간을 요금으로 (퍼블릭 차2 · 하퍼/셔츠 차3)
 *     * 참여자 cha3_amount / cha2_amount 추가 + started_at=now
 *   - ±5/±10 조정 (지연 처리)
 */
import { useEffect, useMemo, useState } from "react"
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setOffsetMin(0) }
  }, [open])

  const nowMs = Date.now()
  const startMs = new Date(currentStartedAt).getTime()
  const elapsedMin = useMemo(() => Math.max(0, Math.floor((nowMs - startMs) / 60_000)), [nowMs, startMs])
  const previewIso = new Date(startMs + offsetMin * 60_000).toISOString()
  const previewHM = fmtHM(previewIso)
  const currentHM = fmtHM(currentStartedAt)
  const nowHM = fmtHM(new Date().toISOString())

  async function patchStartedAt(newIso: string, tag: string) {
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ started_at: newIso }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      toast(`${roomLabel} ${tag} · ${fmtHM(newIso)}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      onClose()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  async function deleteAndRestart() {
    if (busy) return
    if (!confirm(`${roomLabel} 지난 ${elapsedMin}분을 삭제하고 지금(${nowHM}) 재시작?`)) return
    await patchStartedAt(new Date().toISOString(), `${elapsedMin}분 삭제 · 재시작`)
  }

  async function chargeAndRestart() {
    if (busy) return
    // R-cha-charge (2026-09-04): 참여자별 차N 청구 · 서버 endpoint 아직 미구현.
    //   MVP: toast 로 안내 · 시간 리셋만. 실제 요금은 실장이 수동 입력.
    //   차N 종목 자동 청구는 별도 라운드 (participants 배치 endpoint 필요).
    if (!confirm(
      `${roomLabel} 지난 ${elapsedMin}분을 차N 청구 처리 후 재시작?\n\n(참여자별 차N 요금은 확장에서 수동 입력 필요 · 자동 청구 endpoint 추후)`
    )) return
    toast(`⚠ 차N 자동 청구 미구현 · 시간만 재시작 · 확장에서 수동 입력`, "info")
    await patchStartedAt(new Date().toISOString(), `${elapsedMin}분 → 차N (수동) · 재시작`)
  }

  async function applyOffset() {
    if (busy || offsetMin === 0) return
    await patchStartedAt(previewIso, `${offsetMin > 0 ? "+" : ""}${offsetMin}분 조정`)
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        {/* 상단 요약 */}
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            방 시간 조정
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">
            {roomLabel} · 진행 <span className="text-[#A87D45]">{elapsedMin}분</span>
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-[#7A746A]">
            시작 {currentHM} · 지금 {nowHM}
          </div>
        </div>

        {/* Primary 액션 · 시간 삭제 (연장) */}
        <button
          type="button"
          disabled={busy || elapsedMin < 1}
          onClick={deleteAndRestart}
          className={cn(
            "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-2 transition-all",
            busy || elapsedMin < 1
              ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
              : "border-[#A87D45] bg-[#C49B61]/15 text-[#8C6A3A] active:bg-[#C49B61]/25",
          )}
        >
          🔄 <b>{elapsedMin}분 삭제</b> · 재시작 (무료)
        </button>

        {/* Primary 액션 · 차N 청구 (연장) */}
        <button
          type="button"
          disabled={busy || elapsedMin < 1}
          onClick={chargeAndRestart}
          className={cn(
            "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-3 transition-all",
            busy || elapsedMin < 1
              ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
              : "border-red-400 bg-red-50 text-red-800 active:bg-red-100",
          )}
        >
          💰 <b>{elapsedMin}분 → 차N 청구</b> · 재시작
          <div className="text-[9px] font-bold text-red-600 mt-0.5">
            퍼블릭 차2 / 하퍼·셔츠 차3 · 참여자별 차 수당 수동 입력
          </div>
        </button>

        {/* Secondary · ±조정 (지연 처리) */}
        <div className="mt-3 pt-3 border-t border-[#D8D2C8]/40">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">
            시각 미세 조정 {offsetMin !== 0 && (
              <span className="text-[#A87D45]">· {currentHM} → {previewHM}</span>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1.5 mb-2">
            {[-10, -5, 0, 5, 10].map((v) => {
              const on = offsetMin === v
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setOffsetMin(v)}
                  disabled={busy}
                  className={cn(
                    "rounded-xl py-2 text-[12px] font-extrabold border-2 transition-all",
                    on
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                      : "border-[#D8D2C8] bg-white text-[#7A746A]",
                    busy && "opacity-40",
                  )}
                >
                  {v === 0 ? "0" : v > 0 ? `+${v}` : `${v}`}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={busy || offsetMin === 0}
            onClick={applyOffset}
            className={cn(
              "w-full rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
              busy || offsetMin === 0
                ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
                : "border-[#7A746A] bg-white text-[#2D2B26] active:bg-[#FAF5EC]",
            )}
          >
            ⏱ {offsetMin === 0 ? "조정 없음" : `${offsetMin > 0 ? "+" : ""}${offsetMin}분 적용 (${previewHM})`}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="mt-4 w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40"
        >
          닫기
        </button>
      </div>
    </Sheet>
  )
}
