"use client"
/**
 * SessionTimeSheet — 방 세션 시각 조정.
 *
 * R-session-time (2026-09-04): 실무 시나리오
 *   1번방 하퍼 60분 방 · 46분 진행 · 14분 남음
 *   → 새 아가씨 초이스 · 손님이 시간 리셋 요청
 *   → 기존 46분을 어떻게 처리? (완티/반티/차N/무료)
 *   → started_at = now (새 카운트 시작)
 *   → 기존 아가씨: 하퍼 1개 완료 → 2개째 시작 (연장 카운트 +1)
 *
 * flow:
 *   1. 「재시작」 primary 버튼 클릭 → 옵션 노출 (in-sheet, not modal)
 *   2. tier 선택 (elapsed 에 따라 활성/비활성):
 *      · 완티 처리 · 반티 처리 · 차N 처리 · 무료 삭제
 *   3. 선택 → confirm → PATCH started_at + toast
 *   4. 참여자별 실 요금은 EditParticipantSheet 로 수동 (자동 처리는 다음 라운드)
 *
 *   ±5/±10 미세 조정 는 별도 (지연 처리 · 리셋 아님).
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

type Tier = "완티" | "반티" | "차N" | "무료"

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
  const [confirming, setConfirming] = useState(false)  // 재시작 옵션 표시

  useEffect(() => {
    if (open) { setOffsetMin(0); setConfirming(false) }
  }, [open])

  const nowMs = Date.now()
  const startMs = new Date(currentStartedAt).getTime()
  const elapsedMin = useMemo(() => Math.max(0, Math.floor((nowMs - startMs) / 60_000)), [nowMs, startMs])
  const previewIso = new Date(startMs + offsetMin * 60_000).toISOString()
  const previewHM = fmtHM(previewIso)
  const currentHM = fmtHM(currentStartedAt)
  const nowHM = fmtHM(new Date().toISOString())

  // tier 활성 조건 (진행 분수 기준)
  //   완티 처리 = 최소 30분 이상 진행 (실무: 반티 시간 이상 진행 시 완티 라운드로 취급 가능)
  //   반티 처리 = 16분 이상 (반티 최소치)
  //   차N 처리 = 9분 이상 (차N 하한)
  //   무료 = 언제나 가능 (하지만 elapsed<1 이면 원 시각과 동일 · 의미 없음)
  const tierAvailable: Record<Tier, boolean> = {
    "완티": elapsedMin >= 30,
    "반티": elapsedMin >= 16,
    "차N": elapsedMin >= 9,
    "무료": true,
  }
  const tierLabel: Record<Tier, string> = {
    "완티": "완티 처리 · 재시작",
    "반티": "반티 처리 · 재시작",
    "차N": "차N 처리 · 재시작",
    "무료": "무료 삭제 · 재시작",
  }
  const tierHint: Record<Tier, string> = {
    "완티": "기존 아가씨 1개 완료 (연장 카운트 +1) · 완티 요금 청구",
    "반티": "기존 아가씨 반티 요금 청구 · 재시작",
    "차N": "퍼블릭 차2 · 하퍼/셔츠 차3 요금 청구 · 재시작",
    "무료": "지난 시간 무료 처리 · 재시작 (요금 없음)",
  }
  const tierColor: Record<Tier, { border: string; bg: string; text: string; on: string }> = {
    "완티": { border: "border-red-400", bg: "bg-red-50", text: "text-red-800", on: "active:bg-red-100" },
    "반티": { border: "border-orange-400", bg: "bg-orange-50", text: "text-orange-800", on: "active:bg-orange-100" },
    "차N": { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-800", on: "active:bg-amber-100" },
    "무료": { border: "border-[#7A746A]", bg: "bg-white", text: "text-[#2D2B26]", on: "active:bg-[#FAF5EC]" },
  }

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

  async function confirmTier(tier: Tier) {
    if (busy) return
    const label = tierLabel[tier]
    const hint = tierHint[tier]
    if (!confirm(
      `${roomLabel} 지난 ${elapsedMin}분을 ${label} 처리?\n\n${hint}\n\n※ 참여자별 요금은 EditParticipant 로 수동 입력 (자동 청구는 다음 라운드)`
    )) return
    await patchStartedAt(new Date().toISOString(), `${elapsedMin}분 ${tier} 재시작`)
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

        {!confirming && (
          <>
            {/* Primary — 재시작 (옵션 표시로 확장) */}
            <button
              type="button"
              disabled={busy || elapsedMin < 1}
              onClick={() => setConfirming(true)}
              className={cn(
                "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-2 transition-all",
                busy || elapsedMin < 1
                  ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
                  : "border-[#A87D45] bg-[#C49B61]/15 text-[#8C6A3A] active:bg-[#C49B61]/25",
              )}
            >
              🔄 {elapsedMin}분 삭제 · 재시작 (연장)
            </button>
            <div className="text-[10px] font-bold text-[#7A746A] mb-3 text-center leading-relaxed">
              지난 {elapsedMin}분을 어떻게 처리할지 선택
              <br />(완티 / 반티 / 차N / 무료)
            </div>
          </>
        )}

        {confirming && (
          <>
            <div className="mb-2 text-[11px] font-extrabold text-[#7A746A] flex items-center justify-between">
              <span>⚠ 지난 {elapsedMin}분 처리 방식 선택</span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-[10px] font-bold text-[#7A746A] underline"
              >
                뒤로
              </button>
            </div>
            <div className="space-y-2 mb-3">
              {(["완티", "반티", "차N", "무료"] as Tier[]).map((tier) => {
                const avail = tierAvailable[tier]
                const c = tierColor[tier]
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={busy || !avail}
                    onClick={() => confirmTier(tier)}
                    className={cn(
                      "w-full rounded-xl py-3 px-3 text-left border-2 transition-all",
                      avail && !busy
                        ? `${c.border} ${c.bg} ${c.text} ${c.on}`
                        : "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-50 cursor-not-allowed",
                    )}
                  >
                    <div className="text-[13px] font-extrabold">
                      {tier === "완티" && "🎯 "}
                      {tier === "반티" && "🟠 "}
                      {tier === "차N" && "💰 "}
                      {tier === "무료" && "🔄 "}
                      {tierLabel[tier]}
                      {!avail && <span className="ml-1 text-[10px] font-bold">(진행 시간 부족)</span>}
                    </div>
                    <div className="text-[10px] font-semibold mt-0.5 opacity-80">
                      {tierHint[tier]}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Secondary · ±조정 (지연 처리, 재시작 아님) */}
        {!confirming && (
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
        )}

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
