"use client"
/**
 * AddHostessToSessionSheet — 기존 세션에 아가씨 추가 (본 매장 or 외부).
 *
 * R-add-hostess (2026-08-31): /m/staff 확장 카드의 「+ 아가씨 추가」 버튼 대응.
 *   - 종목/시간 pick (default 하퍼/기본, localStorage 기억)
 *   - 이름 검색 → 본 매장 아가씨 + 외부 매장 아가씨 결합 목록
 *   - 클릭 → 즉시 등록 (participants POST)
 *   - 외부 아가씨는 origin_store_uuid 자동 세팅
 *
 * 재사용:
 *   - useBuildingHostesses (전체 5~8F 아가씨)
 *   - useServiceTypes (매장 종목 단가)
 *   - /api/sessions/participants POST
 */
import { useMemo, useState } from "react"
import { Sheet } from "./Sheet"
import { useBuildingHostesses, useServiceTypes, useMe } from "../_hooks/useMobileData"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

type Cat = "퍼블릭" | "하퍼" | "셔츠"
type TimeKey = "기본" | "반티" | "차3"
const CATS: Cat[] = ["퍼블릭", "하퍼", "셔츠"]
const TIMES: TimeKey[] = ["기본", "반티", "차3"]
const LS_CAT = "nox_addhostess_last_cat"
const LS_TIME = "nox_addhostess_last_time"

function readLast<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const v = window.localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch { /* noop */ }
  return fallback
}

export function AddHostessToSessionSheet({
  open,
  onClose,
  sessionId,
  storeUuid,
  roomLabel,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  storeUuid: string
  roomLabel: string
}) {
  const me = useMe()
  const building = useBuildingHostesses()
  const types = useServiceTypes()
  const toast = useToast()

  const [cat, setCat] = useState<Cat>(() => readLast(LS_CAT, CATS, "하퍼"))
  const [time, setTime] = useState<TimeKey>(() => readLast(LS_TIME, TIMES, "기본"))
  const [q, setQ] = useState("")
  const [busyMid, setBusyMid] = useState<string | null>(null)
  // R-scope-own-store (2026-08-31): default 본 매장만 · 외부 검색은 토글로.
  //   사용자 요청 — "내가게 아가씨만 보이는게 맞다" · 외부는 명시적 opt-in.
  const [includeExternal, setIncludeExternal] = useState(false)

  const selectedType = useMemo(() => {
    return (types.data?.service_types ?? []).find(
      (t) => t.service_type === cat && t.time_type === time,
    ) ?? null
  }, [types.data, cat, time])

  const filtered = useMemo(() => {
    const all = building.data?.hostesses ?? []
    const needle = q.trim().toLowerCase()
    const rows = all.filter((h) => {
      // R-scope-own-store (2026-08-31): 외부 매장은 토글 켜야 노출.
      if (!includeExternal && h.store_uuid !== storeUuid) return false
      if (!needle) return true
      return h.hostess_name.toLowerCase().includes(needle)
        || h.store_name.toLowerCase().includes(needle)
        || (h.manager_name ?? "").toLowerCase().includes(needle)
    })
    return rows.sort((a, b) => {
      const aOwn = a.store_uuid === storeUuid ? 0 : 1
      const bOwn = b.store_uuid === storeUuid ? 0 : 1
      if (aOwn !== bOwn) return aOwn - bOwn
      return a.hostess_name.localeCompare(b.hostess_name, "ko")
    }).slice(0, 40)
  }, [building.data, q, storeUuid, includeExternal])
  const totalOwn = useMemo(() => {
    return (building.data?.hostesses ?? []).filter((h) => h.store_uuid === storeUuid).length
  }, [building.data, storeUuid])

  async function add(h: { membership_id: string; hostess_name: string; origin_store_uuid: string | null; store_uuid: string }) {
    if (busyMid || !selectedType) return
    setBusyMid(h.membership_id)
    haptic([10, 30, 10])
    try {
      const isOwn = h.store_uuid === storeUuid
      const originUuid = isOwn ? undefined : (h.origin_store_uuid ?? h.store_uuid)
      const res = await apiFetch("/api/sessions/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: h.membership_id,
          role: "hostess",
          category: cat,
          time_minutes: selectedType.time_minutes,
          time_type: time,
          manager_deduction: selectedType.manager_deduction,
          greeting_confirmed: cat === "셔츠" ? true : undefined,
          ...(originUuid ? { origin_store_uuid: originUuid } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      try {
        window.localStorage.setItem(LS_CAT, cat)
        window.localStorage.setItem(LS_TIME, time)
      } catch { /* noop */ }
      toast(`${h.hostess_name} 추가 · ${roomLabel}`, "success")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
      // 추가된 아가씨는 리스트에서 안 사라지지만 · busy 풀고 사용자가 다른 아가씨 추가 가능
    } catch (e) {
      toast(`추가 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusyMid(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            아가씨 추가
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">{roomLabel}</div>
          <div className="mt-0.5 text-[11px] font-bold text-[#7A746A]">
            우리 매장 · 다른 매장 아가씨 모두 검색 가능
          </div>
        </div>

        {/* 종목 pill */}
        <div className="mb-2">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">종목</div>
          <div className="grid grid-cols-3 gap-1.5">
            {CATS.map((c) => {
              const on = cat === c
              return (
                <button key={c} type="button" onClick={() => setCat(c)}
                  className={cn(
                    "rounded-xl py-2 text-[12px] font-extrabold border-2 transition-all",
                    on ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]" : "border-[#D8D2C8] bg-white text-[#7A746A]",
                  )}>
                  {c}
                </button>
              )
            })}
          </div>
        </div>

        {/* 시간 pill */}
        <div className="mb-3">
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">시간</div>
          <div className="grid grid-cols-3 gap-1.5">
            {TIMES.map((t) => {
              const on = time === t
              return (
                <button key={t} type="button" onClick={() => setTime(t)}
                  className={cn(
                    "rounded-xl py-2 text-[12px] font-extrabold border-2 transition-all",
                    on ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]" : "border-[#D8D2C8] bg-white text-[#7A746A]",
                  )}>
                  {t}
                </button>
              )
            })}
          </div>
        </div>

        {/* 검색 */}
        <div className="mb-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={includeExternal ? "이름 · 매장 · 실장 검색" : "우리 매장 아가씨 이름 검색"}
            className="w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-3 py-2.5 text-[13px] font-bold placeholder:text-[#B0A99B] focus:outline-none focus:border-[#A87D45]"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold text-[#7A746A]">
              {building.isLoading ? "..." : `${filtered.length} / ${includeExternal ? (building.data?.hostesses?.length ?? 0) : totalOwn}명`}
            </div>
            {/* R-scope-own-store (2026-08-31): 외부 아가씨 검색 토글 */}
            <button
              type="button"
              onClick={() => setIncludeExternal((v) => !v)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black border-2 transition-all",
                includeExternal
                  ? "border-amber-400 bg-amber-100 text-amber-800"
                  : "border-[#D8D2C8] bg-white text-[#7A746A]",
              )}
            >
              {includeExternal ? "🌍 외부 매장 ON" : "🏠 우리 매장만"}
            </button>
          </div>
        </div>

        {/* 결과 */}
        <div className="space-y-1 max-h-[45vh] overflow-y-auto">
          {filtered.map((h) => {
            const isOwn = h.store_uuid === storeUuid
            const busy = busyMid === h.membership_id
            return (
              <button
                key={h.membership_id}
                type="button"
                disabled={busy}
                onClick={() => add(h)}
                className={cn(
                  "w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all",
                  busy ? "opacity-40 cursor-wait" : "active:scale-[0.98]",
                  isOwn
                    ? "border-[#C49B61]/40 bg-[#FAF5EC]/60"
                    : "border-[#D8D2C8] bg-white",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">
                      {h.hostess_name}
                      {isOwn && <span className="ml-1 text-[9px] font-bold text-[#A87D45]">본</span>}
                    </div>
                    <div className="text-[10px] font-semibold text-[#7A746A] truncate">
                      {h.store_name}
                      {h.manager_name && ` · ${h.manager_name}`}
                    </div>
                  </div>
                  <div className="text-[11px] font-black text-[#A87D45] shrink-0">
                    {busy ? "..." : "+ 추가"}
                  </div>
                </div>
              </button>
            )
          })}
          {!building.isLoading && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#D8D2C8] px-4 py-6 text-center text-[11px] font-bold text-[#7A746A]">
              검색 결과 없음
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A]"
        >
          닫기
        </button>
      </div>
    </Sheet>
  )
}
