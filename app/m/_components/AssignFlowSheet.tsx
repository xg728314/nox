"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import {
  useServiceTypes,
  useRooms,
  useMe,
  useBuildingStores,
  useBuildingRooms,
} from "../_hooks/useMobileData"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * 스태프 배정 flow — NOX 원칙 "최소 클릭 · 빠른 설정 · 정확성".
 *
 * R-quick-assign (2026-08-30): 이전 4-step wizard (층→매장→종목→시간) 폐기.
 *   본 매장 · 담당=현재 사용자 (자동) · default = 하퍼/기본 (하드코딩).
 *   사용자는 (1) 방 pick, 필요 시 (2) 종목/시간 변경 만 하면 됨.
 *   localStorage 로 마지막 종목/시간 기억 → 다음 열림 때 재사용.
 *
 * 흐름:
 *   1. 빈 방 grid (본 매장 8방) → 클릭 = 방 pick.
 *   2. 종목/시간 pill (default 하퍼/기본 · 최근 사용값 재사용).
 *   3. [배정 완료] → checkin (담당=me) + hostess N명 participants POST.
 *
 * 총 클릭: 3 (방 + 완료 + 필요시 종목/시간 조정).
 */

type Cat = "퍼블릭" | "하퍼" | "셔츠"
type TimeKey = "기본" | "반티" | "차3"

const CATS: Cat[] = ["퍼블릭", "하퍼", "셔츠"]
const TIMES: TimeKey[] = ["기본", "반티", "차3"]
const DEFAULT_CAT: Cat = "하퍼"
const DEFAULT_TIME: TimeKey = "기본"
const LS_CAT_KEY = "nox_assign_last_cat"
const LS_TIME_KEY = "nox_assign_last_time"

const CAT_COLOR: Record<Cat, { bg: string; text: string }> = {
  퍼블릭: { bg: "#EFEBE3", text: "#2D2B26" },
  하퍼: { bg: "#FECACA", text: "#7F1D1D" },
  셔츠: { bg: "#BFDBFE", text: "#1E3A8A" },
}

function readLast<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const v = window.localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch { /* noop */ }
  return fallback
}

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
  const types = useServiceTypes()
  const rooms = useRooms()
  const buildingS = useBuildingStores()
  const buildingR = useBuildingRooms()
  const toast = useToast()

  // R-cross-store-picker (2026-08-30): 5~8F 매장 선택 지원. default = 본 매장 (자기 층).
  const [storeUuid, setStoreUuid] = useState<string | null>(null)
  const [roomUuid, setRoomUuid] = useState<string | null>(null)
  const [cat, setCat] = useState<Cat>(DEFAULT_CAT)
  const [time, setTime] = useState<TimeKey>(DEFAULT_TIME)
  // R-time-offset (2026-08-30): 시작 시각 조정 · 분 단위 · 0 = 지금.
  const [offsetMin, setOffsetMin] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const myStoreUuid = me.data?.store_uuid ?? null
  const myFloor = me.data?.store_floor ?? null

  // Sheet 열릴 때 초기화 + last used cat/time 복원 + default 본 매장
  useEffect(() => {
    if (open) {
      setRoomUuid(null)
      setStoreUuid(myStoreUuid)
      setCat(readLast(LS_CAT_KEY, CATS, DEFAULT_CAT))
      setTime(readLast(LS_TIME_KEY, TIMES, DEFAULT_TIME))
      setOffsetMin(0)
    }
  }, [open, myStoreUuid])

  const isMyStore = storeUuid === myStoreUuid

  // 방 리스트 — 본 매장: useRooms (session 정보 포함). 타 매장: buildingR
  const roomList = useMemo(() => {
    if (isMyStore) {
      return (rooms.data?.rooms ?? [])
        .filter((r) => r.is_active !== false)
        .map((r) => ({ id: r.id, room_no: r.room_no, isActive: !!r.session }))
    }
    if (!storeUuid) return []
    const block = (buildingR.data?.stores ?? []).find((s) => s.store_uuid === storeUuid)
    return (block?.rooms ?? [])
      .filter((r) => r.is_active !== false)
      .map((r) => ({ id: r.room_uuid, room_no: r.room_no, isActive: !!r.session }))
  }, [isMyStore, rooms.data, buildingR.data, storeUuid])

  // 빈 방 자동 pick (본 매장 열림 시)
  useEffect(() => {
    if (!open || roomUuid) return
    const empty = roomList.find((r) => !r.isActive)
    if (empty) setRoomUuid(empty.id)
  }, [open, roomUuid, roomList])

  const selectedRoom = useMemo(() => roomList.find((r) => r.id === roomUuid) ?? null, [roomList, roomUuid])

  // 층 pick — default 본 매장 층
  const floors = [5, 6, 7, 8] as const
  const [pickedFloor, setPickedFloor] = useState<number | null>(null)
  useEffect(() => { if (open) setPickedFloor(myFloor) }, [open, myFloor])
  const currentFloor = pickedFloor ?? myFloor
  const storesInFloor = useMemo(() => {
    return (buildingS.data?.stores ?? [])
      .filter((s) => s.floor === currentFloor)
      .sort((a, b) => a.store_name.localeCompare(b.store_name))
  }, [buildingS.data, currentFloor])

  const selectedType = useMemo(() => {
    return (types.data?.service_types ?? []).find(
      (t) => t.service_type === cat && t.time_type === time,
    ) ?? null
  }, [types.data, cat, time])

  const ready = Boolean(roomUuid && selectedType && hostessIds.length > 0 && me.data?.membership_id && !submitting)

  async function submit() {
    if (!ready || !selectedType || !storeUuid) return
    setSubmitting(true)
    haptic([10, 30, 10])
    // R-time-offset (2026-08-30): 사용자가 조정한 시각 반영 · entered_at 명시.
    const enteredAt = new Date(Date.now() + offsetMin * 60_000).toISOString()
    try {
      if (isMyStore) {
        // 본 매장 flow
        if (!roomUuid) throw new Error("방 선택 필요")
        let sessionId: string | null = null
        const existing = (rooms.data?.rooms ?? []).find((r) => r.id === roomUuid)?.session ?? null
        if (existing) {
          sessionId = existing.id
        } else {
          const res = await apiFetch("/api/sessions/checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // R-time-offset (2026-08-30): checkin 은 started_at override 미지원.
              //   entered_at 은 participants POST 에서 개별 반영.
              room_uuid: roomUuid,
              manager_membership_id: me.data?.membership_id,
              manager_name: me.data?.full_name ?? "",
            }),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok) {
            if (res.status === 409) {
              invalidateApi("/api/rooms")
              await rooms.refresh()
              const again = (rooms.data?.rooms ?? []).find((r) => r.id === roomUuid)?.session
              if (again) sessionId = again.id
              else throw new Error("세션 확보 실패 · 방 새로고침")
            } else {
              throw new Error(j?.message ?? `체크인 실패 HTTP ${res.status}`)
            }
          } else {
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
              entered_at: enteredAt,
            }),
          })
        }

        toast(`${hostessIds.length}명 배정 완료 · ${selectedRoom?.room_no ?? ""}번방`, "success")
      } else {
        // R-pending-pool (2026-08-31): 타 매장 flow → mode="pending".
        //   방 자동 배정 하지 않고 transfer_request 만 생성 (도착 대기 pool).
        //   도착 매장 실장/사장이 조판 홈의 「🚪 도착 대기 N명」 배지 → sheet
        //   에서 방 pick → 정식 등록.
        const res = await apiFetch("/api/cross-store/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_store_uuid: storeUuid,
            hostess_membership_ids: hostessIds,
            category: cat,
            time_type: time,
            mode: "pending",
          }),
        })
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean; message?: string; error?: string
          mode?: string
          pending_count?: number
          target_store?: { name?: string }
          errors?: string[]
        }
        if (!res.ok || !j.ok) throw new Error(j.message ?? j.error ?? j.errors?.[0] ?? `HTTP ${res.status}`)
        const count = j.pending_count ?? 0
        if (count === 0) throw new Error(j.errors?.[0] ?? "요청 생성 실패")
        toast(
          `${count}명 → ${j.target_store?.name ?? "타매장"} 도착 대기 · 방 배정 대기 중`,
          "success",
        )
      }

      try {
        window.localStorage.setItem(LS_CAT_KEY, cat)
        window.localStorage.setItem(LS_TIME_KEY, time)
      } catch { /* noop */ }

      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/manager/settlement/summary")
      onClose()
      router.push("/m")
    } catch (e) {
      toast(`배정 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        {/* 상단 요약 */}
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            빠른 배정
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">
            {hostessNames.length > 0
              ? `${hostessNames.slice(0, 3).join(", ")}${hostessNames.length > 3 ? ` 외 ${hostessNames.length - 3}` : ""} · ${hostessIds.length}명`
              : "스태프 선택 필요"}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-[#7A746A]">
            담당: {me.data?.full_name ?? "?"} · {me.data?.store_name ?? ""}
          </div>
        </div>

        {/* R-cross-store-picker (2026-08-30): 층 pill · 다른 층 pick 지원 (5~8F) */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">층</div>
          <div className="grid grid-cols-4 gap-1.5">
            {floors.map((f) => {
              const on = currentFloor === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setPickedFloor(f)
                    // 층 바꾸면 매장/방 리셋 · 본 매장 층으로 돌아오면 본 매장 자동 pick
                    setStoreUuid(f === myFloor ? myStoreUuid : null)
                    setRoomUuid(null)
                  }}
                  className={cn(
                    "rounded-xl py-2 text-[13px] font-extrabold border-2 transition-all",
                    on
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                      : "border-[#D8D2C8] bg-white text-[#7A746A]",
                  )}
                >
                  {f}F
                </button>
              )
            })}
          </div>
        </div>

        {/* 매장 pill — 해당 층의 매장들 · 본 매장 default */}
        {storesInFloor.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">매장</div>
            <div className="flex flex-wrap gap-1.5">
              {storesInFloor.map((s) => {
                const on = storeUuid === s.store_uuid
                const isMe = s.store_uuid === myStoreUuid
                return (
                  <button
                    key={s.store_uuid}
                    type="button"
                    onClick={() => {
                      setStoreUuid(s.store_uuid)
                      setRoomUuid(null)
                    }}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[12px] font-extrabold border-2 transition-all",
                      on
                        ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                        : "border-[#D8D2C8] bg-white text-[#7A746A]",
                    )}
                  >
                    {s.store_name}
                    {isMe && <span className="ml-1 text-[9px] text-[#A87D45]">본</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 1: 방 pick — grid · 빈 방 하이라이트 · active 방 흐릿 */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">방 선택</div>
          <div className="grid grid-cols-4 gap-1.5">
            {roomList.map((r) => {
              const isSelected = r.id === roomUuid
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRoomUuid(r.id)}
                  className={cn(
                    "rounded-xl py-3 border-2 text-[13px] font-extrabold text-center transition-all",
                    isSelected
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26] scale-[1.02]"
                      : r.isActive
                        ? "border-[#D8D2C8]/40 bg-[#EFEBE3] text-[#7A746A]/60"
                        : "border-[#D8D2C8] bg-white text-[#2D2B26] active:bg-[#FAF5EC]",
                  )}
                >
                  <div>{r.room_no}</div>
                  {r.isActive && (
                    <div className="text-[8px] font-bold mt-0.5 text-[#7A746A]/60">사용중</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Step 2: 종목 pill row · default = 하퍼 · localStorage 기억 */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">종목</div>
          <div className="grid grid-cols-3 gap-1.5">
            {CATS.map((c) => {
              const on = cat === c
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={cn(
                    "rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
                    on ? "border-[#A87D45] scale-[1.02]" : "border-[#D8D2C8]",
                  )}
                  style={on ? { backgroundColor: CAT_COLOR[c].bg, color: CAT_COLOR[c].text } : { backgroundColor: "white", color: "#7A746A" }}
                >
                  {c}
                </button>
              )
            })}
          </div>
        </div>

        {/* Step 3: 시간 pill row · default = 기본 */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">시간</div>
          <div className="grid grid-cols-3 gap-1.5">
            {TIMES.map((t) => {
              const on = time === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  className={cn(
                    "rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
                    on
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26] scale-[1.02]"
                      : "border-[#D8D2C8] bg-white text-[#7A746A]",
                  )}
                >
                  {t}
                </button>
              )
            })}
          </div>
        </div>

        {/* R-time-offset (2026-08-30): 시작 시각 조정 */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">
            시작 시각 {offsetMin === 0 ? "· 지금" : offsetMin > 0 ? `· +${offsetMin}분` : `· ${offsetMin}분`}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {[-10, -5, 0, 5, 10].map((v) => {
              const on = offsetMin === v
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setOffsetMin(v)}
                  className={cn(
                    "rounded-xl py-2 text-[12px] font-extrabold border-2 transition-all",
                    on
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                      : "border-[#D8D2C8] bg-white text-[#7A746A]",
                  )}
                >
                  {v === 0 ? "지금" : v > 0 ? `+${v}` : `${v}`}
                </button>
              )
            })}
          </div>
        </div>

        {/* 하단 액션 */}
        <div className="grid grid-cols-[auto_1fr] gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className={cn(
              "rounded-xl py-3 text-[13px] font-extrabold text-white transition-all",
              ready
                ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] active:scale-[0.98]"
                : "bg-[#D8D2C8] opacity-70",
            )}
          >
            {submitting ? "배정 중..." : `✓ ${hostessIds.length}명 배정 완료`}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
