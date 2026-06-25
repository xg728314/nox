"use client"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { useServiceTypes } from "../_hooks/useMobileData"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * R-extend-end (2026-06-25): 일하는 식구 카드 탭 → 연장/종료 시트.
 *
 *   상단: 식구 이름 + 매장 + 종목 + 남은시간
 *   섹션 1 (연장): 기본 / 반티 / 차3 — 각 가격 표시. 클릭 시 same session 에
 *     새 participant 추가 (POST /api/sessions/participants).
 *   섹션 2 (종료): "지금 종료" 빨간 버튼. POST /api/sessions/participants/[id]/leave.
 *
 *   target_store_uuid 가 본인 매장이 아니면 가격 미리보기는 own service_types
 *   기반으로 안 보임 — 단, extend POST 는 그대로 진행 (서버가 가격 검증).
 */

type TimeKey = "기본" | "반티" | "차3"

export function ExtendEndSheet({
  open,
  onClose,
  membershipId,
  hostessName,
  participantId,
  sessionId,
  category,
  storeName,
  remainingMinutes,
  startedAt,
}: {
  open: boolean
  onClose: () => void
  membershipId: string
  hostessName: string
  participantId: string
  sessionId: string
  category: string | null
  storeName: string | null
  remainingMinutes: number | null
  /** 시작 시각 — 경과시간 계산용 */
  startedAt?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const types = useServiceTypes()
  const [submitting, setSubmitting] = useState(false)

  // 본인 매장 service_types 에서 같은 카테고리 시간/가격 매핑
  const priceMap = useMemo(() => {
    const m = new Map<TimeKey, { time_minutes: number; price: number; manager_deduction: number }>()
    if (!category) return m
    for (const st of types.data?.service_types ?? []) {
      if (st.service_type !== category) continue
      if (st.time_type === "기본" || st.time_type === "반티" || st.time_type === "차3") {
        m.set(st.time_type as TimeKey, {
          time_minutes: st.time_minutes,
          price: st.price,
          manager_deduction: st.manager_deduction,
        })
      }
    }
    return m
  }, [types.data, category])

  async function extend(timeType: TimeKey) {
    if (!category || submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const info = priceMap.get(timeType)
      const res = await apiFetch("/api/sessions/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: membershipId,
          role: "hostess",
          category,
          time_minutes: info?.time_minutes ?? null,
          time_type: timeType,
          manager_deduction: info?.manager_deduction ?? 0,
          greeting_confirmed: category === "셔츠" ? true : undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string; message?: string }
        // R-extend-stale-fix (2026-06-26): 세션이 이미 종료된 경우 — 보통 자동종료(10분
        //   초과 cron) 후 클라이언트 캐시가 stale 일 때 발생. 친절 메시지 + 강제 invalidate.
        if (j?.error === "SESSION_NOT_ACTIVE") {
          toast("이미 종료된 세션입니다. 화면을 갱신합니다.", "info")
          invalidateApi("/api/rooms")
          invalidateApi("/api/manager/hostesses")
          invalidateApi("/api/manager/incoming-staff")
          invalidateApi("/api/manager/settlement/summary")
          onClose()
          router.refresh()
          return
        }
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      toast(`${hostessName} 연장 ${timeType}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.refresh()
    } catch (e) {
      toast(`연장 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * 종료 처리. final_time_type 이 주어지면 leave 직전에 participant 의 time_type /
   * time_minutes / price_amount 를 그 기준으로 PATCH 후 leave.
   */
  async function endWithType(finalTimeType: TimeKey | null) {
    if (submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      // 1. 정산 옵션 변경 (옵션)
      if (finalTimeType) {
        const info = priceMap.get(finalTimeType)
        if (info) {
          const patchRes = await apiFetch(`/api/sessions/participants/${encodeURIComponent(participantId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: finalTimeType === "기본" ? "apply_wanti" : finalTimeType === "반티" ? "apply_banti" : "apply_cha3",
              time_minutes: info.time_minutes,
              price_amount: info.price,
            }),
          })
          if (!patchRes.ok) {
            const j = await patchRes.json().catch(() => ({}))
            // 일부 환경에서 action 미지원 — 일반 PATCH 로 fallback
            const fallback = await apiFetch(`/api/sessions/participants/${encodeURIComponent(participantId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category,
                time_minutes: info.time_minutes,
                price_amount: info.price,
              }),
            })
            if (!fallback.ok) {
              throw new Error(j?.message ?? `정산 변경 실패 HTTP ${patchRes.status}`)
            }
          }
        }
      }
      // 2. leave
      const res = await apiFetch(`/api/sessions/participants/${encodeURIComponent(participantId)}/leave`, {
        method: "POST",
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; session_closed?: boolean }
      if (!res.ok || !j.ok) {
        // R-leave-stale-fix (2026-06-26): 이미 종료된 row — 친절 메시지 + 강제 invalidate.
        //   클라이언트 cache stale 로 사용자가 종료 버튼 재시도 시 발생.
        if (j.error === "ALREADY_LEFT") {
          toast("이미 종료된 스태프입니다. 화면을 갱신합니다.", "info")
          invalidateApi("/api/rooms")
          invalidateApi("/api/manager/hostesses")
          invalidateApi("/api/manager/incoming-staff")
          invalidateApi("/api/manager/settlement/summary")
          onClose()
          router.refresh()
          return
        }
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      const tag = finalTimeType ? ` (${finalTimeType === "기본" ? "완티" : finalTimeType})` : ""
      toast(`${hostessName} 종료${tag}${j.session_closed ? " · 세션 닫힘" : ""}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.refresh()
    } catch (e) {
      toast(`종료 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const headerLine = [storeName, category].filter(Boolean).join(" · ")

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${hostessName} 연장 / 종료`}
      desc={`${headerLine}${remainingMinutes != null ? ` · ${remainingMinutes <= 0 ? "종료" : `${remainingMinutes}분 남음`}` : ""}`}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
        >
          닫기
        </button>
      }
    >
      {/* 연장 섹션 */}
      <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2 mt-1">
        ⏱ 연장
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(["기본", "반티", "차3"] as TimeKey[]).map((t) => {
          const info = priceMap.get(t)
          const label = t === "기본" ? "완티" : t === "반티" ? "반티" : "차3"
          return (
            <button
              key={t}
              type="button"
              disabled={submitting || !info}
              onClick={() => extend(t)}
              className={cn(
                "rounded-2xl px-2 py-3 flex flex-col items-center gap-1 border-2 active:scale-95 transition-transform shadow-sm",
                info ? "bg-white border-[#D8D2C8]" : "bg-[#F0EDE7] border-[#D8D2C8] opacity-60 cursor-not-allowed",
              )}
            >
              <div className="w-10 h-10 rounded-full bg-[#C49B61]/15 text-[#A87D45] flex items-center justify-center text-[14px] font-extrabold">
                {label === "완티" ? "완" : label === "반티" ? "반" : "차"}
              </div>
              <div className="text-[12px] font-extrabold text-[#2D2B26]">{label}</div>
              <div className="text-[10px] font-bold text-[#A87D45]">
                {info ? `${info.time_minutes}분 · ${(info.price / 10000).toFixed(0)}만` : "단가 없음"}
              </div>
            </button>
          )
        })}
      </div>

      {/* 종료 섹션 */}
      <div className="text-[10px] font-extrabold text-red-700 uppercase tracking-wider mb-2">
        🚪 종료 (시간에 따라 정산 옵션 선택)
      </div>
      <EndOptions
        category={category}
        priceMap={priceMap}
        elapsedMinutes={elapsedMinutes(startedAt)}
        submitting={submitting}
        onEnd={endWithType}
      />
      <button
        type="button"
        disabled={submitting}
        onClick={() => endWithType(null)}
        className="w-full mt-2 bg-white border border-[#D8D2C8] text-[#7A746A] rounded-xl py-2.5 text-[11px] font-bold active:scale-[0.98] transition-transform disabled:opacity-40"
      >
        그대로 종료 (현재 정산 유지)
      </button>
    </Sheet>
  )
}

function elapsedMinutes(startedAt?: string | null): number | null {
  if (!startedAt) return null
  const ms = new Date(startedAt).getTime()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.round((Date.now() - ms) / 60_000))
}

/**
 * 종료 옵션 — 시간 비례 가용 옵션 표시.
 *   - 완티: elapsed >= 기본 시간 면 활성, 미만 면 disabled (또는 강제 선택 가능)
 *   - 반티: elapsed >= 반티 시간 (= 기본/2) 면 활성
 *   - 차3:  elapsed >= 차3 시간 (15분) 면 활성
 *   - 사용자 재량으로 시간 미달이어도 선택 가능. disabled 는 시각적 힌트.
 */
function EndOptions({
  category,
  priceMap,
  elapsedMinutes,
  submitting,
  onEnd,
}: {
  category: string | null
  priceMap: Map<TimeKey, { time_minutes: number; price: number; manager_deduction: number }>
  elapsedMinutes: number | null
  submitting: boolean
  onEnd: (t: TimeKey) => void
}) {
  if (!category) return null
  const opts: Array<{ key: TimeKey; label: string }> = [
    { key: "기본", label: "완티 종료" },
    { key: "반티", label: "반티 종료" },
    { key: "차3", label: "차3 종료" },
  ]
  return (
    <div className="space-y-2">
      {opts.map((o) => {
        const info = priceMap.get(o.key)
        if (!info) return null
        const recommended = elapsedMinutes != null && elapsedMinutes >= info.time_minutes
        return (
          <button
            key={o.key}
            type="button"
            disabled={submitting}
            onClick={() => onEnd(o.key)}
            className={`w-full rounded-xl border-2 px-3 py-2.5 text-left flex items-center justify-between active:scale-[0.98] transition-transform disabled:opacity-40 ${
              recommended ? "bg-red-50 border-red-400" : "bg-white border-[#D8D2C8]"
            }`}
          >
            <div>
              <div className="text-[13px] font-extrabold text-[#2D2B26]">
                {o.label} {recommended && <span className="text-[10px] font-bold text-red-600 ml-1">✓ 시간 충분</span>}
              </div>
              <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
                {info.time_minutes}분 기준 · {elapsedMinutes != null && (
                  <span>경과 {elapsedMinutes}분 / 기준 {info.time_minutes}분</span>
                )}
              </div>
            </div>
            <div className="text-[14px] font-extrabold text-red-700">
              {(info.price / 10000).toFixed(0)}만원
            </div>
          </button>
        )
      })}
    </div>
  )
}
