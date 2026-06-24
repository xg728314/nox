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
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      toast(`${hostessName} 연장 ${timeType}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.refresh()
    } catch (e) {
      toast(`연장 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  async function endNow() {
    if (submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(`/api/sessions/participants/${encodeURIComponent(participantId)}/leave`, {
        method: "POST",
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; session_closed?: boolean }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      toast(`${hostessName} 종료${j.session_closed ? " (세션 닫힘)" : ""}`, "success")
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
        🚪 종료
      </div>
      <button
        type="button"
        disabled={submitting}
        onClick={endNow}
        className="w-full bg-red-50 border-2 border-red-300 text-red-700 rounded-2xl py-3 text-[13px] font-extrabold active:scale-[0.98] transition-transform disabled:opacity-40"
      >
        지금 종료 — {hostessName}
      </button>
    </Sheet>
  )
}
