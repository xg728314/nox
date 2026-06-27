"use client"
import Link from "next/link"
import { useMemo, useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useHostesses, useAttendance } from "../../_hooks/useMobileData"
import { invalidateApi } from "../../_hooks/useApi"
import { initialOf } from "../../_lib/format"
import { cn } from "../../_lib/cn"
import { apiFetch } from "@/lib/apiFetch"
import { useToast, haptic } from "../../_components/Toast"

type FilterKey = "all" | "working" | "waiting" | "rest"

export default function StaffListPage() {
  const { data, isLoading, error } = useHostesses()
  const attendance = useAttendance()
  const toast = useToast()
  const [filter, setFilter] = useState<FilterKey>("all")
  const [q, setQ] = useState("")
  const [toggleBusy, setToggleBusy] = useState<string | null>(null)

  const all = data?.hostesses ?? []

  // R-attendance (2026-06-26): 출근 membership_id 집합. 토글 시 즉시 UI 반영.
  const attendedSet = useMemo(() => {
    const s = new Set<string>()
    for (const a of attendance.data?.attendance ?? []) {
      if (a.status === "present") s.add(a.membership_id)
    }
    return s
  }, [attendance.data])

  // R-attendance-bulk (2026-06-27): 진짜 출근자 수 — 일하는 중 + 출근 chip 켜진 식구.
  //   이전엔 attendedSet.size 만 — 일하는중 1명 있어도 카운트 0 으로 표시되던 버그.
  const trulyAttendedCount = useMemo(() => {
    let n = 0
    for (const h of all) {
      if (h.is_working || attendedSet.has(h.membership_id)) n++
    }
    return n
  }, [all, attendedSet])

  // R-bulk-attend (2026-06-27): 일괄 출근 / 결근. 일하는중은 건너뜀 (자동 출근 상태).
  async function bulkAttendance(action: "checkin" | "checkout") {
    if (toggleBusy) return
    setToggleBusy("bulk")
    haptic([10, 30, 10])
    try {
      const targets = all.filter((h) => {
        if (h.is_working) return false  // 일하는중 — 스킵 (자동 출근, 결근 불가)
        const isAttended = attendedSet.has(h.membership_id)
        return action === "checkin" ? !isAttended : isAttended
      })
      if (targets.length === 0) {
        toast(action === "checkin" ? "이미 전원 출근 처리" : "퇴근할 식구 없음", "info")
        return
      }
      let ok = 0, fail = 0
      for (const h of targets) {
        try {
          const res = await apiFetch("/api/attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ membership_id: h.membership_id, action }),
          })
          if (res.ok) ok++; else fail++
        } catch { fail++ }
      }
      invalidateApi("/api/attendance")
      toast(`${action === "checkin" ? "출근" : "퇴근"} ${ok}명 ${fail > 0 ? `(실패 ${fail})` : ""}`, "success")
    } finally {
      setToggleBusy(null)
    }
  }

  async function toggleAttendance(membershipId: string, isAttended: boolean, isWorking: boolean) {
    if (toggleBusy) return
    if (isWorking) {
      toast("일하는 중인 식구는 자동 출근입니다. 세션 종료 후 결근 처리 가능.", "info")
      return
    }
    setToggleBusy(membershipId)
    haptic([10, 20, 10])
    try {
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_id: membershipId,
          action: isAttended ? "checkout" : "checkin",
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      invalidateApi("/api/attendance")
    } catch (e) {
      toast(`처리 실패: ${(e as Error).message}`, "error")
    } finally {
      setToggleBusy(null)
    }
  }

  // 2026-06-12 R-phantom-immediate: 사전등록도 즉시 정식 식구가 됨 →
  //   pre_registrations 별도 섹션 표시 불필요. all 에 다 포함됨.
  // 2026-06-26 R-filter-fix: working/waiting 필터 실제 적용 — 이전엔 상태만 저장하고
  //   필터링 안 했음. is_working 기준. (rest 는 데이터 모델 없음 — UI 만 표시).
  // 2026-06-26 R-search-fix: 한글은 toLowerCase 무의미하지만 includes 는 작동. 다만
  //   매장/종목 검색도 지원하도록 search field 확장 (placeholder 가 이미 "이름/매장/종목").
  const counts = useMemo(() => {
    let w = 0, wt = 0
    for (const h of all) { if (h.is_working) w++; else wt++ }
    return { all: all.length, working: w, waiting: wt, rest: 0 }
  }, [all])
  const filtered = useMemo(() => {
    let list = all
    if (filter === "working") list = list.filter((h) => h.is_working)
    else if (filter === "waiting") list = list.filter((h) => !h.is_working)
    // rest 는 미구현 — UI 만 표시
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((h) => {
        const name = (h.hostess_name ?? "").toLowerCase()
        const cat = (h.working_category ?? "").toLowerCase()
        const store = (h.working_store_name ?? "").toLowerCase()
        return name.includes(needle) || cat.includes(needle) || store.includes(needle)
      })
    }
    return list
  }, [all, q, filter])

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="내 스태프"
        subtitle={
          data?.role === "owner" || data?.role === "manager"
            ? `${data?.role === "owner" ? "사장" : "실장"} · 출근 ${trulyAttendedCount}/${all.length}`
            : undefined
        }
        backHref="/m"
        right={
          <Link
            href="/m/staff/new"
            aria-label="새 스태프 등록"
            className="w-9 h-9 rounded-full bg-[#2D2B26] text-white flex items-center justify-center no-underline text-[14px] font-bold"
          >
            +
          </Link>
        }
      />

      {/* 검색 + 필터 */}
      <div className="px-5 py-3 flex flex-col gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 검색"
          className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-2.5 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
        />
        {/* 일괄 출근 / 결근 버튼 */}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={toggleBusy === "bulk"}
            onClick={() => bulkAttendance("checkin")}
            className="flex-1 rounded-xl py-2 text-[12px] font-extrabold border-2 bg-white border-green-300 text-green-700 active:bg-green-50 disabled:opacity-40"
          >
            {toggleBusy === "bulk" ? "..." : "● 전체 출근"}
          </button>
          <button
            type="button"
            disabled={toggleBusy === "bulk"}
            onClick={() => bulkAttendance("checkout")}
            className="flex-1 rounded-xl py-2 text-[12px] font-extrabold border-2 bg-white border-[#D8D2C8] text-[#7A746A] active:bg-[#FAF5EC] disabled:opacity-40"
          >
            ○ 전체 퇴근
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {(
            [
              { k: "all", lbl: "전체", n: counts.all },
              { k: "working", lbl: "일하는 중", n: counts.working },
              { k: "waiting", lbl: "대기", n: counts.waiting },
            ] as const
          ).map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilter(c.k)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold border transition-colors",
                filter === c.k ? "bg-[#2D2B26] text-white border-[#2D2B26]" : "bg-white text-[#7A746A] border-[#D8D2C8]",
              )}
            >
              {c.lbl} <span className="opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 리스트 */}
      <div className="px-5 pb-24">
        {isLoading && <SkelList />}
        {error && <Err msg="식구 목록을 불러올 수 없습니다" />}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] font-semibold py-10">
            {q ? "검색 결과 없음" : "등록된 식구가 없습니다"}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">
            {filtered.map((h, i) => {
              const isWorking = !!h.is_working
              const isAttended = isWorking || attendedSet.has(h.membership_id)
              const busy = toggleBusy === h.membership_id
              return (
                <div
                  key={h.membership_id}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3",
                    i > 0 && "border-t border-[#D8D2C8]/40",
                    !isAttended && "bg-[#FAFAF7]",
                    isAttended && !isWorking && "bg-green-50/40",
                  )}
                >
                  {/* R-row-tap-toggle (2026-06-27): row 좌측 영역 클릭 = 출근 토글.
                      이전에 chip 영역만 클릭 가능해서 사용자가 못 알아봄 (POST 0건).
                      이젠 row 의 아바타+이름 영역도 누르면 토글. */}
                  <button
                    type="button"
                    disabled={busy || isWorking}
                    onClick={() => toggleAttendance(h.membership_id, isAttended, isWorking)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-60 transition-opacity disabled:cursor-default"
                  >
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[16px] font-extrabold text-[#A87D45] shrink-0">
                      {initialOf(h.hostess_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-extrabold tracking-tight truncate">{h.hostess_name}</div>
                      <div className="text-[10px] font-semibold text-[#7A746A] truncate">
                        {isWorking
                          ? `🟢 일하는 중 · ${h.working_store_name ?? ""} ${h.working_category ?? ""}`
                          : `${h.status === "approved" ? "승인됨" : h.status} · ${h.role}`}
                      </div>
                    </div>
                  </button>
                  {/* 상세 페이지 이동 (별도 작은 링크) */}
                  <Link
                    href={`/m/staff/${encodeURIComponent(h.membership_id)}`}
                    aria-label="상세"
                    className="shrink-0 px-2 py-2 rounded-lg text-[#A87D45] no-underline text-[14px] active:bg-[#FAF5EC]"
                  >
                    ›
                  </Link>
                  {/* R-attendance-switch (2026-06-28): iOS 스타일 ON/OFF 토글 스위치.
                      사용자 요구: '이름 옆에 출근 ON/OFF 기능'. 이전 chip 은 인식 어려움. */}
                  <button
                    type="button"
                    disabled={busy || isWorking}
                    onClick={() => toggleAttendance(h.membership_id, isAttended, isWorking)}
                    aria-label={isAttended ? "출근 ON — 클릭하여 OFF" : "출근 OFF — 클릭하여 ON"}
                    className={cn(
                      "shrink-0 flex items-center gap-2 transition-all disabled:opacity-60",
                    )}
                  >
                    <span className={cn(
                      "text-[11px] font-extrabold transition-colors",
                      isAttended ? "text-green-700" : "text-[#7A746A]",
                    )}>
                      {busy ? "..." : isWorking ? "일하는중" : isAttended ? "ON" : "OFF"}
                    </span>
                    {/* 스위치 트랙 */}
                    <span className={cn(
                      "relative inline-block w-[44px] h-[26px] rounded-full transition-colors border-2",
                      isWorking
                        ? "bg-green-200 border-green-400"
                        : isAttended
                          ? "bg-green-500 border-green-600"
                          : "bg-[#E5E0D6] border-[#D8D2C8]",
                    )}>
                      {/* 스위치 노브 */}
                      <span
                        className={cn(
                          "absolute top-[1px] w-[18px] h-[18px] rounded-full bg-white shadow-md transition-all duration-200",
                        )}
                        style={{ left: isAttended ? "20px" : "2px" }}
                      />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function SkelList() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-[#EFEBE3] animate-pulse" />
      ))}
    </div>
  )
}
function Err({ msg }: { msg: string }) {
  return <div className="text-center text-red-600 text-[12px] font-semibold py-6">{msg}</div>
}
