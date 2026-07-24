"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHeader } from "../../_components/PageHeader"
import { useToast, haptic } from "../../_components/Toast"
import { useBuildingHostesses, useBuildingStores, useMe, useRooms, useServiceTypes } from "../../_hooks/useMobileData"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../../_hooks/useApi"
import { cn } from "../../_lib/cn"

type CatKey = "퍼블릭" | "셔츠" | "하퍼"
type TimeKey = "기본" | "반티" | "차3"

const CAT_LABEL: Record<CatKey, string> = { 퍼블릭: "P 타입", 셔츠: "S 타입", 하퍼: "H 타입" }
const CAT_ORDER: CatKey[] = ["퍼블릭", "셔츠", "하퍼"]
const TIME_ORDER: TimeKey[] = ["기본", "반티", "차3"]

/**
 * 세션 등록 — /m/assign
 *
 * 흐름:
 *  1. 스태프 선택 (내 식구 / 전체 5–8F, 검색 + 다중 선택)
 *  2. 매장 (목적지) — 본인 매장 default
 *  3. 룸 (본인 매장만 우선 지원, 다른 매장은 mock list)
 *  4. 종목 (P/S/H) → 시간 (기본/반티/차3)
 *  5. 시작 시각 (±5/±10 분 조정, default 현재)
 *  6. 등록 → 본인 매장이면 checkin + participants, 다른 매장이면 cross-store record + 알림
 */
export default function AssignSessionPage() {
  const router = useRouter()
  const search = useSearchParams()
  const toast = useToast()
  const me = useMe()
  const buildingH = useBuildingHostesses()
  const buildingS = useBuildingStores()
  const rooms = useRooms()
  const types = useServiceTypes()

  const initialStaff = search?.get("staff") ?? ""
  // R-external-dispatch (2026-07-24): 외부조판 (/m/staff) 에서 "+ 체크인" 클릭 시
  //   해당 방·매장 pre-select 하도록 destStore + room query param 지원.
  const initialDestStore = search?.get("destStore") ?? ""
  const initialRoom = search?.get("room") ?? ""
  const [scope, setScope] = useState<"mine" | "all">("mine")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set(initialStaff ? [initialStaff] : []))
  const [destStoreUuid, setDestStoreUuid] = useState<string>(initialDestStore)
  const [roomUuid, setRoomUuid] = useState<string>(initialRoom)
  const [cat, setCat] = useState<CatKey | null>(null)
  const [time, setTime] = useState<TimeKey | null>(null)
  const [offsetMin, setOffsetMin] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)

  // 본인 매장 기본값 — query param 이 있으면 그것 우선, 없으면 본인 매장.
  useEffect(() => {
    if (me.data?.store_uuid && !destStoreUuid) {
      setDestStoreUuid(me.data.store_uuid)
    }
  }, [me.data, destStoreUuid])

  const isCrossStore = useMemo(
    () => Boolean(destStoreUuid && me.data?.store_uuid && destStoreUuid !== me.data.store_uuid),
    [destStoreUuid, me.data?.store_uuid],
  )

  // hostess 필터
  const filteredHostesses = useMemo(() => {
    const list = buildingH.data?.hostesses ?? []
    const myMem = me.data?.membership_id
    const filtered = list.filter((h) => {
      if (scope === "mine" && h.manager_membership_id !== myMem) return false
      if (q.trim()) {
        return (h.hostess_name ?? "").toLowerCase().includes(q.trim().toLowerCase())
      }
      return true
    })
    return filtered
  }, [buildingH.data, scope, q, me.data?.membership_id])

  // 룸 옵션 — 본인 매장이면 실제 rooms 사용
  const roomOptions = useMemo(() => {
    if (!isCrossStore && rooms.data) {
      return rooms.data.rooms.map((r) => ({
        id: r.id,
        label: r.room_name || `룸 ${r.room_no}`,
        hasSession: !!r.session,
      }))
    }
    return Array.from({ length: 8 }).map((_, i) => ({
      id: `mock-room-${i + 1}`,
      label: `룸 ${i + 1}`,
      hasSession: false,
    }))
  }, [isCrossStore, rooms.data])

  // 시작 시각 표시
  const startTime = useMemo(() => {
    const d = new Date()
    d.setMinutes(d.getMinutes() + offsetMin)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }, [offsetMin])

  // 단가 미리보기
  const pricePreview = useMemo(() => {
    if (!cat || !time) return null
    const t = types.data?.service_types.find((x) => x.service_type === cat && x.time_type === time)
    return t ?? null
  }, [cat, time, types.data])

  const ready = selected.size > 0 && destStoreUuid && roomUuid && cat && time

  async function submit() {
    if (!ready || submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      let sessionId: string | null = null

      if (!isCrossStore) {
        // 본인 매장: 룸의 활성 세션 재사용 or 신규 checkin
        const existing = rooms.data?.rooms.find((r) => r.id === roomUuid)?.session
        if (existing) {
          sessionId = existing.id
        } else {
          const res = await apiFetch("/api/sessions/checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              room_uuid: roomUuid,
              manager_membership_id: me.data?.membership_id,
              manager_name: me.data?.full_name ?? "",
            }),
          })
          if (!res.ok) {
            if (res.status === 409) {
              // 동시에 다른 사용자가 checkin — rooms 재조회
              invalidateApi("/api/rooms")
              await rooms.refresh()
              const again = rooms.data?.rooms.find((r) => r.id === roomUuid)?.session
              if (again) sessionId = again.id
              else throw new Error("세션을 얻지 못했습니다 (race)")
            } else {
              throw new Error(`HTTP ${res.status}`)
            }
          } else {
            const j = await res.json()
            sessionId = j.session_id
          }
        }
      }

      if (!sessionId && !isCrossStore) throw new Error("session_id 응답 없음")

      // 참여자 추가 (본인 매장)
      if (sessionId) {
        for (const mid of selected) {
          const h = filteredHostesses.find((x) => x.membership_id === mid)
          await apiFetch("/api/sessions/participants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              membership_id: mid,
              role: "hostess",
              category: cat,
              time_minutes: pricePreview?.time_minutes ?? null,
              time_type: time,
              manager_deduction: pricePreview?.manager_deduction ?? 0,
              origin_store_uuid: h?.origin_store_uuid ?? undefined,
              greeting_confirmed: cat === "셔츠" ? true : undefined,
            }),
          })
        }
        toast(`${selected.size}명 등록 완료`, "success")
      } else {
        // 타 매장 등록은 다음 라운드 (cross_store_work_records POST 흐름 필요)
        toast("타 매장 등록은 다음 라운드 지원", "info")
      }

      invalidateApi("/api/rooms")
      invalidateApi("/api/manager/settlement")
      router.push("/m")
    } catch (e) {
      toast(`등록 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="세션 등록" subtitle={me.data?.store_name ?? ""} backHref="/m" />

      <div className="px-5 pb-32 flex flex-col gap-4">
        {/* 1. 스태프 선택 */}
        <Section
          title="스태프 선택"
          right={<span className="text-[10px] font-bold text-[#A87D45]">{selected.size}명 선택</span>}
        >
          <div className="flex gap-1 bg-[#EFEBE3] rounded-xl p-1 mb-2">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-extrabold rounded-lg",
                  scope === s ? "bg-white text-[#2D2B26] shadow-sm" : "text-[#7A746A]",
                )}
              >
                {s === "mine" ? "내 식구" : "전체 (5–8F)"}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 검색"
            className="w-full bg-white border border-[#D8D2C8] rounded-xl px-3 py-2 text-[12px] outline-none focus:border-[#C49B61] mb-2"
          />
          <div className="max-h-[220px] overflow-y-auto bg-white rounded-xl border border-[#D8D2C8]/60">
            {buildingH.isLoading && (
              <div className="text-center text-[11px] text-[#7A746A] py-6">로딩 중...</div>
            )}
            {!buildingH.isLoading && filteredHostesses.length === 0 && (
              <div className="text-center text-[11px] text-[#7A746A] py-6">{q ? "검색 결과 없음" : "스태프가 없습니다"}</div>
            )}
            {filteredHostesses.map((h, i) => {
              const sel = selected.has(h.membership_id)
              return (
                <button
                  key={h.membership_id}
                  type="button"
                  onClick={() => {
                    setSelected((s) => {
                      const n = new Set(s)
                      if (n.has(h.membership_id)) n.delete(h.membership_id)
                      else n.add(h.membership_id)
                      return n
                    })
                    haptic(6)
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 text-left",
                    i > 0 && "border-t border-[#D8D2C8]/40",
                    sel && "bg-[#C49B61]/10",
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0",
                      sel ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] border-transparent" : "bg-white border-[#D8D2C8]",
                    )}
                  >
                    {sel && <span className="text-white text-[10px] font-extrabold">✓</span>}
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[12px] font-extrabold text-[#A87D45] shrink-0">
                    {h.hostess_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">{h.hostess_name}</div>
                    <div className="text-[10px] font-semibold text-[#7A746A] truncate flex gap-1.5 items-center">
                      {h.manager_membership_id === me.data?.membership_id ? (
                        <span className="bg-[#C49B61]/15 text-[#A87D45] px-1.5 rounded-full text-[9px] font-extrabold">
                          내 식구
                        </span>
                      ) : (
                        <span className="bg-blue-500/12 text-blue-700 px-1.5 rounded-full text-[9px] font-extrabold">
                          {h.manager_name || "타 실장"}
                        </span>
                      )}
                      <span>{h.store_name}{h.floor != null && ` · ${h.floor}F`}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </Section>

        {/* 2. 매장 + 룸 */}
        <Section title="어디로?">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-extrabold text-[#7A746A] mb-1">매장</div>
              <select
                value={destStoreUuid}
                onChange={(e) => {
                  setDestStoreUuid(e.target.value)
                  setRoomUuid("")
                }}
                className="w-full bg-white border border-[#D8D2C8] rounded-xl px-3 py-2 text-[12px] font-bold outline-none"
              >
                {(buildingS.data?.stores ?? []).map((s) => (
                  <option key={s.store_uuid} value={s.store_uuid}>
                    {s.store_name}
                    {s.floor != null && ` · ${s.floor}F`}
                    {s.store_uuid === me.data?.store_uuid && " (본 매장)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-extrabold text-[#7A746A] mb-1">룸</div>
              <select
                value={roomUuid}
                onChange={(e) => setRoomUuid(e.target.value)}
                className="w-full bg-white border border-[#D8D2C8] rounded-xl px-3 py-2 text-[12px] font-bold outline-none"
              >
                <option value="">선택...</option>
                {roomOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.hasSession && " (활성)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isCrossStore && (
            <div className="mt-2 text-[10px] text-blue-700 bg-blue-500/10 rounded-lg px-3 py-2 font-semibold">
              ⓘ 타 매장 등록 — 도착 매장 실장의 확인이 필요합니다 (다음 라운드 완성)
            </div>
          )}
        </Section>

        {/* 3. 종목 + 시간 */}
        <Section title="종목 · 시간">
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {CAT_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCat(c)
                  haptic(8)
                }}
                className={cn(
                  "rounded-xl px-2 py-2 text-center border-2 transition-colors",
                  cat === c ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent" : "bg-white border-[#D8D2C8] text-[#2D2B26]",
                )}
              >
                <div className="text-[12px] font-extrabold">{CAT_LABEL[c]}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {TIME_ORDER.map((t) => {
              const opt = types.data?.service_types.find((x) => x.service_type === cat && x.time_type === t)
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!cat}
                  onClick={() => {
                    setTime(t)
                    haptic(8)
                  }}
                  className={cn(
                    "rounded-xl px-2 py-2 text-center border-2 transition-colors",
                    time === t ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent" : "bg-white border-[#D8D2C8] text-[#2D2B26]",
                    !cat && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <div className="text-[12px] font-extrabold">{t}</div>
                  {opt && (
                    <div className={cn("text-[9px] font-bold mt-0.5", time === t ? "text-white/80" : "text-[#7A746A]")}>
                      {opt.time_minutes}분 · {Math.round(opt.price / 10000)}만
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </Section>

        {/* 4. 시작 시각 ± */}
        <Section title="시작 시각">
          <div className="bg-white rounded-xl border border-[#D8D2C8]/60 p-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOffsetMin((v) => Math.max(-60, v - 10))
                haptic(6)
              }}
              className="w-11 h-11 rounded-lg bg-[#EFEBE3] border border-[#D8D2C8] text-[12px] font-extrabold active:scale-95"
            >
              -10
            </button>
            <button
              type="button"
              onClick={() => {
                setOffsetMin((v) => Math.max(-60, v - 5))
                haptic(6)
              }}
              className="w-11 h-11 rounded-lg bg-[#EFEBE3] border border-[#D8D2C8] text-[12px] font-extrabold active:scale-95"
            >
              -5
            </button>
            <div
              className="flex-1 text-center cursor-pointer"
              onDoubleClick={() => {
                setOffsetMin(0)
                haptic(8)
              }}
            >
              <div className="text-[26px] font-extrabold leading-none tracking-tighter tabular-nums">{startTime}</div>
              <div className={cn("text-[11px] font-bold mt-0.5", offsetMin === 0 ? "text-[#7A746A]" : "text-[#A87D45]")}>
                {offsetMin === 0 ? "지금" : offsetMin < 0 ? `${-offsetMin}분 전 들어감` : `${offsetMin}분 후 예정`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOffsetMin((v) => Math.min(30, v + 5))
                haptic(6)
              }}
              className="w-11 h-11 rounded-lg bg-[#EFEBE3] border border-[#D8D2C8] text-[12px] font-extrabold active:scale-95"
            >
              +5
            </button>
            <button
              type="button"
              onClick={() => {
                setOffsetMin((v) => Math.min(30, v + 10))
                haptic(6)
              }}
              className="w-11 h-11 rounded-lg bg-[#EFEBE3] border border-[#D8D2C8] text-[12px] font-extrabold active:scale-95"
            >
              +10
            </button>
          </div>
          <div className="text-[10px] text-[#7A746A] font-semibold mt-1 px-1">안 건드리면 현재 시각으로 등록됩니다</div>
        </Section>

        {/* 미리보기 + 등록 */}
        {ready && pricePreview && (
          <div className="bg-[#C49B61]/10 border border-[#C49B61]/30 rounded-xl px-4 py-3 text-[12px] font-bold text-[#2D2B26]">
            <b>{selected.size}명</b> → <b>{cat}</b> · <b>{time}</b> ({pricePreview.time_minutes}분 ·{" "}
            {Math.round(pricePreview.price / 10000)}만원) · {startTime} 시작
          </div>
        )}
      </div>

      <div
        className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#D8D2C8]/60 px-5 py-3 flex gap-2 z-10"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!ready || submitting}
          className="flex-[2] bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
        >
          {submitting ? "등록 중..." : ready ? `${selected.size}명 등록` : "정보를 모두 입력하세요"}
        </button>
      </div>
    </div>
  )
}

function Section({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[11px] font-extrabold text-[#7A746A] uppercase tracking-wider">{title}</div>
        {right}
      </div>
      {children}
    </section>
  )
}
