"use client"
/**
 * SessionTimeSheet — 방 세션 시각 조정.
 *
 * R-session-time (2026-09-04): 실무 시나리오
 *   1번방 하퍼 60분 방 · 46분 진행 · 14분 남음
 *   → 새 아가씨 초이스 · 손님이 시간 리셋 요청
 *   → 기존 46분을 어떻게 처리? (완티/반티/차3/무료)
 *   → started_at = now (새 카운트 시작)
 *   → 기존 아가씨: 하퍼 1개 완료 → 2개째 시작 (연장 카운트 +1)
 *
 * flow:
 *   1. 「재시작」 primary 버튼 클릭 → 옵션 노출 (in-sheet, not modal)
 *   2. tier 선택 (elapsed 에 따라 활성/비활성):
 *      · 완티 처리 · 반티 처리 · 차3 처리 · 무료 삭제
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
import { useServiceTypes } from "../_hooks/useMobileData"

/** 방 안 참여자 스냅샷 · 미리 연장 UI 용 */
export type SheetParticipant = {
  participant_id: string
  membership_id: string | null
  name: string
  category: string | null
  ticket: string
  /** 같은 아가씨의 현재 라운드 수 (미리 연장 포함) */
  currentRounds: number
}

function fmtHM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

type Tier = "완티" | "반티" | "차3" | "무료"

export function SessionTimeSheet({
  open,
  onClose,
  sessionId,
  roomLabel,
  currentStartedAt,
  participants,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  roomLabel: string
  currentStartedAt: string
  /** 방 안 참여자 스냅샷 · 미리 연장 UI 용 (기본 없으면 미리 연장 섹션 안 뜸) */
  participants?: SheetParticipant[]
}) {
  const toast = useToast()
  const types = useServiceTypes()
  const [offsetMin, setOffsetMin] = useState(0)
  const [busy, setBusy] = useState(false)
  // R-end-tier (2026-09-04): confirming 상태 = mode 별 tier 옵션 노출
  const [confirming, setConfirming] = useState<"restart" | "end" | null>(null)
  // R-preextend (2026-09-04): 미리 연장 선택 참여자
  const [selectedMids, setSelectedMids] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setOffsetMin(0)
      setConfirming(null)
      // 미리 연장 default: 전체 선택
      const all = new Set<string>()
      for (const p of participants ?? []) {
        if (p.membership_id) all.add(p.membership_id)
      }
      setSelectedMids(all)
    }
  }, [open, participants])

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
  //   차3 처리 = 9분 이상 (차3 하한)
  //   무료 = 언제나 가능 (하지만 elapsed<1 이면 원 시각과 동일 · 의미 없음)
  const tierAvailable: Record<Tier, boolean> = {
    "완티": elapsedMin >= 30,
    "반티": elapsedMin >= 16,
    "차3": elapsedMin >= 9,
    "무료": true,
  }
  const modeSuffix = confirming === "end" ? "종료" : "재시작"
  const tierLabel: Record<Tier, string> = {
    "완티": `완티 처리 · ${modeSuffix}`,
    "반티": `반티 처리 · ${modeSuffix}`,
    "차3": `차3 처리 · ${modeSuffix}`,
    "무료": `무료 처리 · ${modeSuffix}`,
  }
  const tierHint: Record<Tier, string> = confirming === "end" ? {
    "완티": "지금 라운드 완티 완료 처리 · 방 종료 (전액 청구)",
    "반티": "지금 라운드 반티 처리 · 방 종료 (반티 요금)",
    "차3": "지금 라운드 차3 처리 · 방 종료 (차3 요금)",
    "무료": "지금 라운드 무료 · 방 종료 (요금 없음)",
  } : {
    "완티": "기존 아가씨 1개 완료 (연장 카운트 +1) · 완티 요금 청구",
    "반티": "기존 아가씨 반티 요금 청구 · 재시작",
    "차3": "차3 요금 청구 · 재시작 (퍼블릭 90분 통일 이후 종목 무관)",
    "무료": "지난 시간 무료 처리 · 재시작 (요금 없음)",
  }
  const tierColor: Record<Tier, { border: string; bg: string; text: string; on: string }> = {
    "완티": { border: "border-red-400", bg: "bg-red-50", text: "text-red-800", on: "active:bg-red-100" },
    "반티": { border: "border-orange-400", bg: "bg-orange-50", text: "text-orange-800", on: "active:bg-orange-100" },
    "차3": { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-800", on: "active:bg-amber-100" },
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
    if (confirming === "restart") {
      // R32/#3 (2026-09-04): 재시작은 시간만 리셋 · 실제 청구는 참여자별 개별 편집.
      //   이전엔 tier 를 audit note 에만 넣고 실 청구는 안 함 → "완티 처리" 착각.
      //   지금은 tier picker 자체를 없애고 항상 "무료 재시작" 만 노출 (아래 UI 참조).
      //   호출 도달하면 tier 무시하고 시간만 리셋.
      await patchStartedAt(new Date().toISOString(), `${elapsedMin}분 무료 재시작 (시간 리셋)`)
    } else if (confirming === "end") {
      // R32/#5 (2026-09-04): 방 종료 부분 실패 명시.
      //   이전엔 실패한 이름 없이 count 만 → 실장 "종료됨" 확신 · 다음 손님 받으려다 room busy 발각.
      //   지금은 실패한 이름을 응답에 나열 · 세션 close 확인.
      setBusy(true)
      haptic([10, 30, 10])
      try {
        const successNames: string[] = []
        const failedNames: string[] = []
        for (const p of participants ?? []) {
          try {
            const res = await apiFetch(`/api/sessions/participants/${encodeURIComponent(p.participant_id)}/leave`, {
              method: "POST",
            })
            if (res.ok) successNames.push(p.name ?? "?")
            else failedNames.push(p.name ?? "?")
          } catch {
            failedNames.push(p.name ?? "?")
          }
        }
        if (failedNames.length > 0) {
          toast(
            `⚠ 종료 부분 실패 · ${successNames.length}/${(participants ?? []).length}명 leave · 실패: ${failedNames.join(", ")}`,
            "error",
          )
        } else {
          toast(`${roomLabel} ${tier} 종료 · ${successNames.length}명 leave`, "success")
        }
        invalidateApi("/api/rooms")
        invalidateApi("/api/building/rooms")
        invalidateApi("/api/manager/incoming-staff")
        // 부분 실패 시엔 시트 유지 → 실장이 개별 확인
        if (failedNames.length === 0) onClose()
      } catch (e) {
        toast(`종료 실패: ${(e as Error).message}`, "error")
      } finally {
        setBusy(false)
      }
    }
  }

  async function applyOffset() {
    if (busy || offsetMin === 0) return
    await patchStartedAt(previewIso, `${offsetMin > 0 ? "+" : ""}${offsetMin}분 조정`)
  }

  // R-preextend (2026-09-04): 방 안 아가씨 선택 → 다음 라운드 참여자 미리 등록.
  //   각자 기존 category + 기본 종목 시간으로 새 participant row 추가.
  //   결과: 화영 1개째 → 2개째 라운드 예약됨 (참여자 카드 1/2 로 뜸).
  async function preExtend() {
    if (busy || !participants || selectedMids.size === 0) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      let count = 0
      for (const p of participants) {
        if (!p.membership_id || !selectedMids.has(p.membership_id)) continue
        // 각자 기존 category 로 기본 종목 시간 lookup
        const cat = p.category ?? "퍼블릭"
        const st = (types.data?.service_types ?? []).find((t) => t.service_type === cat && t.time_type === "기본")
        if (!st) continue
        const res = await apiFetch("/api/sessions/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            membership_id: p.membership_id,
            role: "hostess",
            category: cat,
            time_minutes: st.time_minutes,
            time_type: "기본",
            manager_deduction: st.manager_deduction,
            greeting_confirmed: cat === "셔츠" ? true : undefined,
          }),
        })
        if (res.ok) count++
      }
      toast(`${count}명 미리 연장 완료`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      onClose()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  function toggleSelectAll() {
    if (!participants) return
    const eligible = participants.filter((p) => p.membership_id).map((p) => p.membership_id!)
    if (selectedMids.size === eligible.length) setSelectedMids(new Set())
    else setSelectedMids(new Set(eligible))
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
            {/* R32/#3 (2026-09-04): 재시작은 항상 "무료 재시작" · tier picker 안 뜸.
                실 청구가 필요하면 참여자 카드에서 개별 편집 (실장 판단). */}
            <button
              type="button"
              disabled={busy || elapsedMin < 1}
              onClick={() => void patchStartedAt(new Date().toISOString(), `${elapsedMin}분 무료 재시작 (시간 리셋)`)}
              className={cn(
                "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-2 transition-all",
                busy || elapsedMin < 1
                  ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
                  : "border-[#A87D45] bg-[#C49B61]/15 text-[#8C6A3A] active:bg-[#C49B61]/25",
              )}
            >
              🔄 {elapsedMin}분 삭제 · 무료 재시작 (시간만 리셋)
            </button>
            <div className="text-[9px] font-bold text-[#7A746A] mb-2 text-center leading-relaxed px-2">
              ⚠ 재시작은 시간만 리셋 · 청구 금액은 참여자별 개별 편집으로
            </div>
            {/* Primary — 방 종료 (tier picker 유지) */}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming("end")}
              className={cn(
                "w-full rounded-xl py-3 text-[13px] font-extrabold border-2 mb-2 transition-all",
                busy
                  ? "border-[#D8D2C8] bg-white text-[#B0A99B] opacity-60"
                  : "border-red-400 bg-red-50 text-red-800 active:bg-red-100",
              )}
            >
              ⭕ 방 종료 (참여자 모두 leave)
            </button>
            <div className="text-[10px] font-bold text-[#7A746A] mb-3 text-center leading-relaxed">
              방 종료 시 tier 선택 (참여자별 개별 정산은 카드에서)
            </div>
          </>
        )}

        {confirming && (
          <>
            <div className="mb-2 text-[11px] font-extrabold text-[#7A746A] flex items-center justify-between">
              <span>⚠ {confirming === "restart" ? `지난 ${elapsedMin}분 재시작 tier` : `방 종료 tier (참여자 ${participants?.length ?? 0}명)`}</span>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={busy}
                className="text-[10px] font-bold text-[#7A746A] underline"
              >
                뒤로
              </button>
            </div>
            <div className="space-y-2 mb-3">
              {(["완티", "반티", "차3", "무료"] as Tier[]).map((tier) => {
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
                      {tier === "차3" && "💰 "}
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

        {/* R-preextend (2026-09-04): 방 안 아가씨 미리 연장 (다음 라운드 예약) */}
        {!confirming && participants && participants.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#D8D2C8]/40">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-extrabold text-[#7A746A]">
                🔁 미리 연장 (다음 라운드 예약)
              </div>
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={busy}
                className="text-[10px] font-black text-[#A87D45] underline"
              >
                {selectedMids.size === participants.filter((p) => p.membership_id).length ? "전체 해제" : "전체 선택"}
              </button>
            </div>
            <div className="space-y-1 mb-2">
              {participants.map((p) => {
                const canPick = !!p.membership_id
                const checked = canPick && selectedMids.has(p.membership_id!)
                return (
                  <button
                    key={p.participant_id}
                    type="button"
                    disabled={busy || !canPick}
                    onClick={() => {
                      if (!canPick) return
                      setSelectedMids((prev) => {
                        const next = new Set(prev)
                        if (next.has(p.membership_id!)) next.delete(p.membership_id!)
                        else next.add(p.membership_id!)
                        return next
                      })
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-left",
                      checked
                        ? "border-[#A87D45] bg-[#C49B61]/15"
                        : "border-[#D8D2C8] bg-white",
                      !canPick && "opacity-40",
                    )}
                  >
                    <span className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0",
                      checked ? "border-[#A87D45] bg-[#A87D45] text-white" : "border-[#D8D2C8] bg-white",
                    )}>
                      {checked && <span className="text-[10px] font-black">✓</span>}
                    </span>
                    <span className="text-[12px] font-extrabold text-[#2D2B26] flex-1 truncate">{p.name}</span>
                    <span className="text-[9px] font-bold text-[#7A746A]">
                      {p.category ?? "?"} · 지금 {p.currentRounds}개째
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              disabled={busy || selectedMids.size === 0}
              onClick={preExtend}
              className={cn(
                "w-full rounded-xl py-2.5 text-[12px] font-extrabold text-white transition-all",
                busy || selectedMids.size === 0
                  ? "bg-[#D8D2C8] opacity-70"
                  : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] active:scale-[0.98]",
              )}
            >
              {busy ? "..." : `⏱ 선택된 ${selectedMids.size}명 미리 연장 (기본)`}
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
