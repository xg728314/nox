"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import {
  useBuildingStores,
  useServiceTypes,
  useRooms,
  useMe,
  type ServiceType,
} from "../_hooks/useMobileData"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * 스태프 배정 흐름 시트 — /m 에서 식구 카드 → 즉시 배정 4-step wizard.
 *
 *   1. 층 (5/6/7/8) — 큰 아이콘
 *   2. 매장 (해당 층의 상호 목록) — 카드 grid
 *   3. 종목 (퍼블릭 / 하퍼 / 셔츠) — 색 구분 아이콘
 *   4. 시간 (기본 / 반티 / 차3)  + 확인
 *
 *   ─ 본인 매장: room 자동 첫 빈룸 사용 + checkin → participants
 *   ─ 타 매장: 다음 라운드 (cross_store_work_records POST 미구현)
 */

type Step = "floor" | "store" | "service" | "time"
type Cat = "퍼블릭" | "하퍼" | "셔츠"
type TimeKey = "기본" | "반티" | "차3"

const FLOORS = [5, 6, 7, 8] as const

const CAT_META: Record<Cat, { icon: string; from: string; to: string; sub: string }> = {
  퍼블릭: { icon: "P", from: "#EFEBE3", to: "#DDD5C5", sub: "90분/45분/15분" },
  하퍼: { icon: "H", from: "#FEE2E2", to: "#FECACA", sub: "60분/30분/15분" },
  셔츠: { icon: "S", from: "#DBEAFE", to: "#BFDBFE", sub: "60분/30분/15분 (인사확인)" },
}
const TIMES: TimeKey[] = ["기본", "반티", "차3"]

export function AssignFlowSheet({
  open,
  onClose,
  hostessIds,
  hostessNames,
}: {
  open: boolean
  onClose: () => void
  hostessIds: string[]
  hostessNames: string[]
}) {
  const router = useRouter()
  const me = useMe()
  const buildingS = useBuildingStores()
  const types = useServiceTypes()
  const rooms = useRooms()
  const toast = useToast()

  const [step, setStep] = useState<Step>("floor")
  const [floor, setFloor] = useState<number | null>(null)
  const [storeUuid, setStoreUuid] = useState<string | null>(null)
  const [cat, setCat] = useState<Cat | null>(null)
  const [time, setTime] = useState<TimeKey | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 시트 열릴 때마다 리셋 (선택은 살리고 step 초기화)
  useEffect(() => {
    if (open) {
      setStep("floor")
      setFloor(null)
      setStoreUuid(null)
      setCat(null)
      setTime(null)
    }
  }, [open])

  const floorStores = useMemo(() => {
    const all = buildingS.data?.stores ?? []
    if (floor == null) return []
    return all.filter((s) => s.floor === floor).sort((a, b) => a.store_name.localeCompare(b.store_name))
  }, [buildingS.data, floor])

  const selectedStore = useMemo(
    () => floorStores.find((s) => s.store_uuid === storeUuid) ?? null,
    [floorStores, storeUuid],
  )
  const isMyStore = !!(me.data?.store_uuid && storeUuid === me.data.store_uuid)

  const matchingTypes = useMemo(() => {
    if (!cat) return []
    return (types.data?.service_types ?? []).filter((t) => t.service_type === cat)
  }, [cat, types.data])

  const selectedType: ServiceType | null = useMemo(() => {
    if (!cat || !time) return null
    return matchingTypes.find((t) => t.time_type === time) ?? null
  }, [matchingTypes, cat, time])

  async function submit() {
    if (!cat || !time || !selectedType || hostessIds.length === 0 || submitting) return
    if (!storeUuid) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      if (isMyStore) {
        // 본인 매장 — 첫 빈 룸 자동 선택, 없으면 첫 룸의 active session 재사용
        const rs = rooms.data?.rooms ?? []
        const emptyRoom = rs.find((r) => !r.session && r.is_active !== false)
        const fallbackRoom = rs.find((r) => r.is_active !== false)
        const targetRoom = emptyRoom ?? fallbackRoom
        if (!targetRoom) throw new Error("사용 가능한 룸 없음")

        let sessionId: string | null = null
        if (targetRoom.session) {
          sessionId = targetRoom.session.id
        } else {
          const res = await apiFetch("/api/sessions/checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              room_uuid: targetRoom.id,
              manager_membership_id: me.data?.membership_id,
              manager_name: me.data?.full_name ?? "",
            }),
          })
          if (!res.ok) {
            if (res.status === 409) {
              invalidateApi("/api/rooms")
              await rooms.refresh()
              const again = (rooms.data?.rooms ?? []).find((r) => r.id === targetRoom.id)?.session
              if (again) sessionId = again.id
              else throw new Error("세션 확보 실패 (race)")
            } else {
              throw new Error(`체크인 실패 HTTP ${res.status}`)
            }
          } else {
            const j = await res.json()
            sessionId = j.session_id
          }
        }
        if (!sessionId) throw new Error("session_id 없음")

        for (const mid of hostessIds) {
          await apiFetch("/api/sessions/participants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              membership_id: mid,
              role: "hostess",
              category: cat,
              time_minutes: selectedType.time_minutes,
              time_type: time,
              manager_deduction: selectedType.manager_deduction,
              greeting_confirmed: cat === "셔츠" ? true : undefined,
            }),
          })
        }
        toast(`${hostessIds.length}명 배정 완료 — ${targetRoom.room_name || `룸 ${targetRoom.room_no}`}`, "success")
      } else {
        // 타 매장 — cross-store dispatch endpoint 호출 (서버가 세션 + 참여자 일괄 처리)
        const res = await apiFetch("/api/cross-store/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_store_uuid: storeUuid,
            hostess_membership_ids: hostessIds,
            category: cat,
            time_type: time,
          }),
        })
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          message?: string
          error?: string
          participants_created?: number
          room?: { room_no?: string; room_name?: string | null }
          target_store?: { name?: string }
        }
        if (!res.ok || !j.ok) {
          throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
        }
        const roomLabel = j.room?.room_name || (j.room?.room_no ? `룸 ${j.room.room_no}` : "")
        toast(`${j.participants_created ?? hostessIds.length}명 → ${j.target_store?.name ?? "타매장"} ${roomLabel} 배정 완료`, "success")
      }
      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.push("/m")
    } catch (e) {
      toast(`배정 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const stepIndex = (["floor", "store", "service", "time"] as Step[]).indexOf(step) + 1

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${hostessIds.length === 1 ? hostessNames[0] : `${hostessIds.length}명`} 배정 (${stepIndex}/4)`}
      desc={crumbs(floor, selectedStore?.store_name, cat, time)}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              if (step === "floor") onClose()
              else if (step === "store") setStep("floor")
              else if (step === "service") setStep("store")
              else if (step === "time") setStep("service")
            }}
            className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
          >
            {step === "floor" ? "취소" : "← 이전"}
          </button>
          {step === "time" && (
            <button
              type="button"
              onClick={submit}
              disabled={!time || submitting}
              className="flex-[2] bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
            >
              {submitting ? "배정 중..." : "✓ 배정 완료"}
            </button>
          )}
        </>
      }
    >
      {/* Step 1 — Floor */}
      {step === "floor" && (
        <div className="grid grid-cols-2 gap-3">
          {FLOORS.map((f) => {
            const cnt = (buildingS.data?.stores ?? []).filter((s) => s.floor === f).length
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFloor(f)
                  setStep("store")
                  haptic(8)
                }}
                className="aspect-[1.2/1] rounded-2xl bg-gradient-to-br from-[#FFFCF6] to-[#F0E8D8] border-2 border-[#D8D2C8]/60 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform shadow-sm"
              >
                <div className="text-[34px] font-extrabold tracking-tighter bg-gradient-to-br from-[#2D2B26] to-[#A87D45] bg-clip-text text-transparent">
                  {f}F
                </div>
                <div className="text-[10px] font-bold text-[#7A746A]">{cnt}개 매장</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Step 2 — Store */}
      {step === "store" && (
        <div className="grid grid-cols-2 gap-2">
          {floorStores.length === 0 && (
            <div className="col-span-2 text-center text-[12px] text-[#7A746A] font-semibold py-8">
              {floor}F 매장 없음
            </div>
          )}
          {floorStores.map((s) => {
            const mine = s.store_uuid === me.data?.store_uuid
            return (
              <button
                key={s.store_uuid}
                type="button"
                onClick={() => {
                  setStoreUuid(s.store_uuid)
                  setStep("service")
                  haptic(8)
                }}
                className={cn(
                  "rounded-2xl px-3 py-3 flex flex-col items-start gap-1 border-2 active:scale-95 transition-transform shadow-sm",
                  mine
                    ? "bg-gradient-to-br from-[#C49B61]/15 to-[#A87D45]/10 border-[#C49B61]/40"
                    : "bg-[#FFFCF6] border-[#D8D2C8]/60",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-[#A87D45] bg-[#C49B61]/15 px-2 py-0.5 rounded-full">
                    {s.floor}F
                  </span>
                  {mine && (
                    <span className="text-[9px] font-extrabold text-white bg-gradient-to-br from-[#C49B61] to-[#A87D45] px-2 py-0.5 rounded-full">
                      본 매장
                    </span>
                  )}
                </div>
                <div className="text-[14px] font-extrabold tracking-tight text-[#2D2B26]">{s.store_name}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Step 3 — Service */}
      {step === "service" && (
        <>
          {!isMyStore && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-blue-800 mb-3">
              타 매장 배정 — 대상 매장에 자동으로 세션 개설 + 식구 등록 (origin_store 자동 기록)
            </div>
          )}
          <div className="grid grid-cols-3 gap-2.5">
            {(["퍼블릭", "하퍼", "셔츠"] as Cat[]).map((c) => {
              const meta = CAT_META[c]
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCat(c)
                    setStep("time")
                    haptic(8)
                  }}
                  className="aspect-[1/1.2] rounded-2xl border-2 border-[#D8D2C8]/60 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-sm"
                  style={{ background: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
                >
                  <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-[24px] font-extrabold text-[#2D2B26] shadow-inner">
                    {meta.icon}
                  </div>
                  <div className="text-[12px] font-extrabold text-[#2D2B26]">{c}</div>
                  <div className="text-[9px] font-bold text-[#7A746A] text-center">{meta.sub}</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Step 4 — Time */}
      {step === "time" && cat && (
        <div className="space-y-2">
          {TIMES.map((t) => {
            const st = matchingTypes.find((s) => s.time_type === t)
            const active = time === t
            return (
              <button
                key={t}
                type="button"
                disabled={!st}
                onClick={() => {
                  setTime(t)
                  haptic(6)
                }}
                className={cn(
                  "w-full rounded-xl px-4 py-3 flex items-center justify-between border-2 active:scale-[0.98] transition-all",
                  active
                    ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent"
                    : st
                      ? "bg-white border-[#D8D2C8] text-[#2D2B26]"
                      : "bg-[#F0EDE7] border-[#D8D2C8] text-[#A09A8E] cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-extrabold", active ? "bg-white/20 text-white" : "bg-[#C49B61]/15 text-[#A87D45]")}>
                    {t === "기본" ? "기" : t === "반티" ? "반" : "차"}
                  </div>
                  <div className="text-left">
                    <div className="text-[14px] font-extrabold">{t}</div>
                    <div className={cn("text-[10px] font-semibold", active ? "text-white/80" : "text-[#7A746A]")}>
                      {st ? `${st.time_minutes}분` : "단가 미설정"}
                    </div>
                  </div>
                </div>
                <div className={cn("text-[16px] font-extrabold", active ? "text-white" : "text-[#A87D45]")}>
                  {st ? `${(st.price / 10000).toFixed(0)}만원` : "—"}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

function crumbs(floor: number | null, store: string | null | undefined, cat: Cat | null, time: TimeKey | null) {
  const parts: string[] = []
  if (floor != null) parts.push(`${floor}F`)
  if (store) parts.push(store)
  if (cat) parts.push(cat)
  if (time) parts.push(time)
  return parts.length > 0 ? parts.join(" › ") : "층 선택 → 매장 → 종목 → 시간"
}
