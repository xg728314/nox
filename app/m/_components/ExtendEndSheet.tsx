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
  // R-extend-confirm (2026-09-04): 남은 시간 있을 때 「미리 연장」 여부 확인 modal
  const [pendingExtend, setPendingExtend] = useState<{ timeType: TimeKey; timeMinutes: number } | null>(null)

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

  // R-extend-confirm (2026-09-04): 남은 시간 있을 때 「미리 연장」 여부 확인.
  //   남은 시간 3분 미만이면 confirm 없이 즉시 실행 (실무 · 곧 끝이라 사실상 새 라운드).
  //   3분 이상이면 modal 표시 · 사용자가 선택:
  //     - '미리 예약' → 그대로 새 참여자 추가 (기존 유지)
  //     - '지금 종료 후' → 기존 leave + 새 라운드
  async function extendWithMinutes(timeMinutes: number, timeType?: TimeKey) {
    if (!category || submitting) return
    // remainingMinutes 있고 3분 초과면 확인 필요
    if (timeType && remainingMinutes != null && remainingMinutes > 3) {
      setPendingExtend({ timeType, timeMinutes })
      return
    }
    await doExtendNow(timeMinutes, timeType)
  }

  async function doExtendNow(timeMinutes: number, timeType?: TimeKey) {
    if (!category) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const info = timeType ? priceMap.get(timeType) : undefined
      const res = await apiFetch("/api/sessions/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: membershipId,
          role: "hostess",
          category,
          time_minutes: timeMinutes,
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
      toast(`${hostessName} 연장 ${timeType ?? `${timeMinutes}분`}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")  // 라운드 배지 즉시 갱신 (R-extend-confirm)
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

  // R-extend-confirm (2026-09-04): 「지금 종료 후 새 라운드」 flow
  //   기존 참여자 leave (남은 시간 무시) + 새 참여자 추가.
  async function doExtendAfterEnd(timeMinutes: number, timeType: TimeKey) {
    if (!category) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      // 1. 기존 참여자 leave (남은 시간 tier 기록 없이 · 실장이 EditParticipant 로 조정)
      const leaveRes = await apiFetch(`/api/sessions/participants/${encodeURIComponent(participantId)}/leave`, {
        method: "POST",
      })
      // ALREADY_LEFT 는 skip · 다른 에러는 throw
      if (!leaveRes.ok) {
        const j = await leaveRes.json().catch(() => ({})) as { error?: string; message?: string }
        if (j?.error !== "ALREADY_LEFT") throw new Error(j?.message ?? `leave HTTP ${leaveRes.status}`)
      }
      // 2. 새 참여자 추가
      const info = priceMap.get(timeType)
      const res = await apiFetch("/api/sessions/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: membershipId,
          role: "hostess",
          category,
          time_minutes: timeMinutes,
          time_type: timeType,
          manager_deduction: info?.manager_deduction ?? 0,
          greeting_confirmed: category === "셔츠" ? true : undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      toast(`${hostessName} 종료 후 재시작 · ${timeType}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.refresh()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // preset 연장 (기본/반티/차3) — 기존 코드 호환.
  async function extend(timeType: TimeKey) {
    const info = priceMap.get(timeType)
    if (!info) return
    await extendWithMinutes(info.time_minutes, timeType)
  }

  // 직접 분 입력 연장 (custom)
  async function extendCustom(minutes: number) {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) return
    await extendWithMinutes(minutes)
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
      // R-leave-incoming-invalidate (2026-06-26): 외부 식구 종료 시 incoming-staff 도
      //   즉시 갱신되어야 홈/정산 화면에서 사라짐. 이전엔 이게 빠져서 종료가 화면에
      //   실시간 반영 안 됨 (5s TTL 만료 후에야 사라짐 = "반응이 느리다" 증상).
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
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
      {/* R-extend-confirm (2026-09-04): 남은 시간 있을 때 확인 modal */}
      {pendingExtend && (
        <div className="mb-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3">
          <div className="text-[11px] font-black text-amber-800 mb-1">
            ⚠ 남은 시간 {remainingMinutes}분 있어요
          </div>
          <div className="text-[11px] text-amber-800/90 mb-2 leading-relaxed">
            <b>{hostessName}</b> 님 지금 시간 {remainingMinutes}분 남아있어요.
            <br />
            어떻게 연장할까요?
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                const p = pendingExtend
                setPendingExtend(null)
                void doExtendNow(p.timeMinutes, p.timeType)
              }}
              className="w-full rounded-lg py-2.5 text-[12px] font-black bg-white border-2 border-amber-500 text-amber-800 active:bg-amber-100 disabled:opacity-40"
            >
              🔁 미리 연장 (남은 시간 이어서 새 라운드)
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                const p = pendingExtend
                setPendingExtend(null)
                void doExtendAfterEnd(p.timeMinutes, p.timeType)
              }}
              className="w-full rounded-lg py-2.5 text-[12px] font-black bg-white border-2 border-red-400 text-red-700 active:bg-red-50 disabled:opacity-40"
            >
              ⭕ 지금 종료 후 새 시작 (남은 {remainingMinutes}분 무시)
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setPendingExtend(null)}
              className="w-full rounded-lg py-2 text-[11px] font-black bg-transparent border border-[#D8D2C8] text-[#7A746A] disabled:opacity-40"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 연장 · 딜레이 조정 (프로토타입 매칭 · informational preview) */}
      <ExtendControls
        priceMap={priceMap}
        submitting={submitting}
        onExtend={extend}
        onExtendCustom={extendCustom}
      />

      {/* 종료 섹션 (심플화 · '그대로 종료' 삭제) */}
      <div className="text-[10px] font-extrabold text-red-700 uppercase tracking-wider mb-2">
        🚪 종료
      </div>
      <EndOptions
        category={category}
        priceMap={priceMap}
        elapsedMinutes={elapsedMinutes(startedAt)}
        submitting={submitting}
        onEnd={endWithType}
      />
    </Sheet>
  )
}

/**
 * 연장 컨트롤 (심플화 · 2026-07-25):
 *   - 딜레이 조정 (-5/-1/+1/+5) — 사용자 필수 유지
 *   - 3 카드: 완티 · 반티 · 차3
 *   삭제: 종료 예정 preview 라인, 직접 분 입력 → 필수 아님
 *
 *   딜레이 값은 UI 표시용 (실 서버는 지금 시각 사용).
 */
function ExtendControls({
  priceMap,
  submitting,
  onExtend,
  onExtendCustom: _onExtendCustom,
}: {
  priceMap: Map<TimeKey, { time_minutes: number; price: number; manager_deduction: number }>
  submitting: boolean
  onExtend: (t: TimeKey) => void | Promise<void>
  onExtendCustom: (m: number) => void | Promise<void>
}) {
  const [delayMin, setDelayMin] = useState(0)
  void _onExtendCustom // 직접 분 UI 삭제로 미사용 · signature 유지

  const startMs = Date.now() + delayMin * 60_000
  const startHm = fmtHM(new Date(startMs))

  return (
    <div className="mb-3">
      <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2 mt-1">
        ⏱ 연장
      </div>

      {/* 딜레이 조정 (컴팩트) */}
      <div className="bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl p-2 mb-2">
        <div className="text-[10px] font-bold text-[#7A746A] mb-1">
          시작 시각 <span className="text-[#A87D45]">(딜레이 ±)</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setDelayMin((v) => v - 5)} className="w-8 h-8 rounded-md bg-white border border-[#D8D2C8] text-[11px] font-extrabold text-[#2D2B26]">-5</button>
          <button type="button" onClick={() => setDelayMin((v) => v - 1)} className="w-8 h-8 rounded-md bg-white border border-[#D8D2C8] text-[11px] font-extrabold text-[#2D2B26]">-1</button>
          <div className="flex-1 text-center bg-white border border-[#D8D2C8] rounded-md py-1.5 text-[13px] font-extrabold text-[#2D2B26] font-mono">
            {startHm}
          </div>
          <button type="button" onClick={() => setDelayMin((v) => v + 1)} className="w-8 h-8 rounded-md bg-white border border-[#D8D2C8] text-[11px] font-extrabold text-[#2D2B26]">+1</button>
          <button type="button" onClick={() => setDelayMin((v) => v + 5)} className="w-8 h-8 rounded-md bg-white border border-[#D8D2C8] text-[11px] font-extrabold text-[#2D2B26]">+5</button>
        </div>
      </div>

      {/* 3 카드 (컴팩트) */}
      <div className="grid grid-cols-3 gap-1.5">
        {(["기본", "반티", "차3"] as TimeKey[]).map((t) => {
          const info = priceMap.get(t)
          const label = t === "기본" ? "완티" : t === "반티" ? "반티" : "차3"
          return (
            <button
              key={t}
              type="button"
              disabled={submitting || !info}
              onClick={() => info && onExtend(t)}
              className={cn(
                "rounded-xl px-2 py-2 flex flex-col items-center gap-0.5 border-2 active:scale-95 transition-transform",
                info ? "bg-white border-[#D8D2C8]" : "bg-[#F0EDE7] border-[#D8D2C8] opacity-60 cursor-not-allowed",
              )}
            >
              <div className="w-7 h-7 rounded-full bg-[#C49B61]/15 text-[#A87D45] flex items-center justify-center text-[11px] font-extrabold">
                {label === "완티" ? "완" : label === "반티" ? "반" : "차"}
              </div>
              <div className="text-[11px] font-extrabold text-[#2D2B26]">{label}</div>
              <div className="text-[9px] font-bold text-[#A87D45]">
                {info ? `${info.time_minutes}분·${(info.price / 10000).toFixed(0)}만` : "미설정"}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
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
