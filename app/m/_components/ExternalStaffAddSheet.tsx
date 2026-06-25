"use client"
import { useMemo, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { useBuildingHostesses, useServiceTypes, useMe } from "../_hooks/useMobileData"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * R-external-add-search (2026-06-26): 외부 식구 수동 추가 시트.
 *
 *   - 채팅 패턴이 아닌 직접 검색으로 등록.
 *   - 이유: 다른 매장이 출근자 명단 전체 노출을 꺼리는 경우 → 이름 검색 방식.
 *   - 흐름: 이름 검색 → 후보 선택 → 종목 → 시간 → 배정 완료.
 *   - dispatch endpoint 그대로 활용 (cross-store 자동 처리).
 */

type Step = "search" | "service" | "time"
type Cat = "퍼블릭" | "셔츠" | "하퍼"
type TimeKey = "기본" | "반티" | "차3"

const CAT_META: Record<Cat, { from: string; to: string }> = {
  퍼블릭: { from: "#EFEBE3", to: "#DDD5C5" },
  하퍼: { from: "#FEE2E2", to: "#FECACA" },
  셔츠: { from: "#DBEAFE", to: "#BFDBFE" },
}

type Hostess = {
  hostess_id: string
  membership_id: string
  hostess_name: string
  store_uuid: string
  store_name: string
}

export function ExternalStaffAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe()
  const buildingH = useBuildingHostesses()
  const types = useServiceTypes()
  const toast = useToast()

  const [step, setStep] = useState<Step>("search")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Hostess | null>(null)
  const [cat, setCat] = useState<Cat | null>(null)
  const [time, setTime] = useState<TimeKey | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 시트 열릴 때마다 리셋
  useState(() => { /* noop */ })
  if (!open && (step !== "search" || picked || cat || time || q)) {
    setStep("search"); setPicked(null); setCat(null); setTime(null); setQ("")
  }

  const searchResults = useMemo(() => {
    const nm = q.trim().toLowerCase()
    if (!nm) return []
    const all = buildingH.data?.hostesses ?? []
    // 본 매장 식구 제외 — 외부 식구만 검색
    const external = all.filter((h) => h.store_uuid !== me.data?.store_uuid)
    return external
      .filter((h) => (h.hostess_name ?? "").toLowerCase().includes(nm))
      .slice(0, 20)
  }, [q, buildingH.data, me.data?.store_uuid])

  const priceMap = useMemo(() => {
    const m = new Map<TimeKey, { time_minutes: number; price: number; manager_deduction: number }>()
    if (!cat) return m
    for (const st of types.data?.service_types ?? []) {
      if (st.service_type !== cat) continue
      if (st.time_type === "기본" || st.time_type === "반티" || st.time_type === "차3") {
        m.set(st.time_type as TimeKey, {
          time_minutes: st.time_minutes,
          price: st.price,
          manager_deduction: st.manager_deduction,
        })
      }
    }
    return m
  }, [cat, types.data])

  async function submit() {
    if (!picked || !cat || !time || !me.data?.store_uuid || submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/cross-store/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_store_uuid: me.data.store_uuid,
          hostess_membership_ids: [picked.membership_id],
          category: cat,
          time_type: time,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        error?: string
        participants_created?: number
        errors?: string[]
        room?: { room_no?: string; room_name?: string | null }
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      const created = j.participants_created ?? 0
      if (created === 0) {
        throw new Error(j.errors?.[0] ?? "참여자 등록 실패")
      }
      const roomLabel = j.room?.room_name || (j.room?.room_no ? `룸 ${j.room.room_no}` : "")
      toast(`${picked.hostess_name} → 본 매장 ${roomLabel} 배정`, "success")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/rooms")
      onClose()
    } catch (e) {
      toast(`추가 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={picked ? `${picked.hostess_name} (${picked.store_name})` : "외부 식구 추가"}
      desc={
        step === "search"
          ? "이름 입력 → 자동완성에서 선택 (본 매장 식구 제외)"
          : step === "service"
            ? "종목 선택"
            : "시간 선택"
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              if (step === "search") onClose()
              else if (step === "service") setStep("search")
              else if (step === "time") setStep("service")
            }}
            className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
          >
            {step === "search" ? "닫기" : "← 이전"}
          </button>
          {step === "time" && (
            <button
              type="button"
              onClick={submit}
              disabled={!time || submitting}
              className="flex-[2] bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
            >
              {submitting ? "추가 중..." : "✓ 추가"}
            </button>
          )}
        </>
      }
    >
      {step === "search" && (
        <div className="space-y-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="식구 이름 입력 (예: 미라, 다은)"
            autoComplete="off"
            className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-2.5 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
          />
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-[10px] font-bold text-blue-700 leading-snug">
            본 매장 식구는 검색되지 않습니다 (외부 매장만). 다른 매장의 출근 명단 전체 노출 방지 — 정확한 이름 입력 필요.
          </div>
          {q.trim() && searchResults.length === 0 && (
            <div className="text-center text-[11px] text-[#7A746A] font-semibold py-4">
              검색 결과 없음
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto bg-white rounded-xl border border-[#D8D2C8]/60">
            {searchResults.map((h, i) => (
              <button
                key={h.membership_id}
                type="button"
                onClick={() => {
                  setPicked({
                    hostess_id: h.hostess_id,
                    membership_id: h.membership_id,
                    hostess_name: h.hostess_name,
                    store_uuid: h.store_uuid,
                    store_name: h.store_name,
                  })
                  setStep("service")
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left active:bg-[#FAF5EC]",
                  i > 0 && "border-t border-[#D8D2C8]/40",
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[12px] font-extrabold text-[#A87D45]">
                  {(h.hostess_name ?? "?").charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">{h.hostess_name}</div>
                  <div className="text-[10px] font-semibold text-[#7A746A] truncate">{h.store_name}</div>
                </div>
                <div className="text-[14px] text-[#D8D2C8]">›</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "service" && (
        <div className="grid grid-cols-3 gap-2.5">
          {(["퍼블릭", "하퍼", "셔츠"] as Cat[]).map((c) => {
            const meta = CAT_META[c]
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setCat(c); setStep("time") }}
                className="aspect-[1/1.1] rounded-2xl border-2 border-[#D8D2C8]/60 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform shadow-sm"
                style={{ background: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
              >
                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[20px] font-extrabold text-[#2D2B26] shadow-inner">
                  {c.charAt(0)}
                </div>
                <div className="text-[12px] font-extrabold text-[#2D2B26]">{c}</div>
              </button>
            )
          })}
        </div>
      )}

      {step === "time" && cat && (
        <div className="space-y-2">
          {(["기본", "반티", "차3"] as TimeKey[]).map((t) => {
            const info = priceMap.get(t)
            const active = time === t
            return (
              <button
                key={t}
                type="button"
                disabled={!info}
                onClick={() => setTime(t)}
                className={cn(
                  "w-full rounded-xl px-4 py-3 flex items-center justify-between border-2 transition-all",
                  active
                    ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                    : info
                      ? "bg-white border-[#D8D2C8] text-[#2D2B26]"
                      : "bg-[#F0EDE7] border-[#D8D2C8] text-[#A09A8E] cursor-not-allowed opacity-60",
                )}
              >
                <div className="text-left">
                  <div className="text-[14px] font-extrabold">{t === "기본" ? "완티" : t}</div>
                  <div className={cn("text-[10px] font-semibold", active ? "text-white/80" : "text-[#7A746A]")}>
                    {info ? `${info.time_minutes}분` : "단가 없음"}
                  </div>
                </div>
                <div className={cn("text-[16px] font-extrabold", active ? "text-white" : "text-[#A87D45]")}>
                  {info ? `${(info.price / 10000).toFixed(0)}만원` : "—"}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
