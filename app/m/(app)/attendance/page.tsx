"use client"
import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useHostesses, useAttendance } from "../../_hooks/useMobileData"
import { useToast, haptic } from "../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../../_hooks/useApi"
import { cn } from "../../_lib/cn"

type Status = "present" | "absent" | "on_break"
type Manager = { membership_id: string; name: string }

// R-attendance-enum-fix (2026-06-28): UI Status ↔ DB status 매핑.
function uiToDb(s: Status): "available" | "in_room" | "off_duty" {
  return s === "present" ? "available" : s === "on_break" ? "in_room" : "off_duty"
}

export default function AttendancePage() {
  const hostesses = useHostesses()
  const attendance = useAttendance()
  const toast = useToast()
  const [pending, setPending] = useState<Set<string>>(new Set())

  // R-manager-assign-attendance (2026-08-23): 실장 할당 UI
  const [managers, setManagers] = useState<Manager[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMgrId, setBulkMgrId] = useState<string>("")

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/api/store/staff")
        const j = await r.json()
        const list: Manager[] = (j.staff || [])
          .filter((s: { role: string }) => s.role === "manager")
          .map((s: { membership_id: string; full_name?: string; name?: string }) => ({
            membership_id: s.membership_id,
            name: s.full_name || s.name || "?",
          }))
        setManagers(list)
      } catch { /* silent */ }
    })()
  }, [])

  const managerNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mgr of managers) m.set(mgr.membership_id, mgr.name)
    return m
  }, [managers])

  const all = hostesses.data?.hostesses ?? []
  const map = new Map((attendance.data?.attendance ?? []).map((a) => [a.membership_id, a]))

  async function setStatus(membershipId: string, status: Status) {
    setPending((s) => new Set(s).add(membershipId))
    haptic(8)
    try {
      const apiAction =
        status === "present" ? "checkin"
          : status === "on_break" ? "unassign"
            : "checkout"
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, action: apiAction }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      invalidateApi("/api/attendance")
      await attendance.refresh()
      toast("출근 상태 변경", "success")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setPending((s) => {
        const n = new Set(s); n.delete(membershipId); return n
      })
    }
  }

  async function assignManager(hostessMid: string, managerMid: string | null) {
    setPending((s) => new Set(s).add(hostessMid))
    try {
      const res = await apiFetch(`/api/hostesses/${hostessMid}/assign`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manager_membership_id: managerMid }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast(`실장 지정 실패: ${j.message || j.error || res.status}`, "error")
      const name = managerMid ? (managerNameById.get(managerMid) ?? "") : "미지정"
      toast(`실장 지정: ${name}`, "success")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/building/hostesses")
      await hostesses.refresh()
    } catch (e) {
      toast(`실장 지정 실패: ${(e as Error).message}`, "error")
    } finally {
      setPending((s) => {
        const n = new Set(s); n.delete(hostessMid); return n
      })
    }
  }

  async function bulkAssign() {
    if (selected.size === 0 || !bulkMgrId) return
    for (const hid of Array.from(selected)) {
      await assignManager(hid, bulkMgrId)
    }
    setSelected(new Set())
    setBulkMgrId("")
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleAll = () => {
    if (selected.size === all.length) setSelected(new Set())
    else setSelected(new Set(all.map((h) => h.membership_id)))
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="출근 체크" subtitle={`${all.length}명 등록`} backHref="/m/staff" />

      {/* R-manager-assign-attendance (2026-08-23): 일괄 실장 할당 툴바 · 선택 있을 때만 */}
      {managers.length > 0 && selected.size > 0 && (
        <div className="sticky top-0 z-20 mx-5 mt-2 rounded-xl bg-[#FBF6EC] border border-[#C49B61] p-3 shadow-md">
          <div className="text-[11px] font-extrabold text-[#8C6A3A] mb-2">
            📋 선택 {selected.size}명 → 실장 지정
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={bulkMgrId}
              onChange={(e) => setBulkMgrId(e.target.value)}
              className="flex-1 rounded-lg border border-[#C49B61] px-2 py-1.5 text-[12px] font-bold text-[#2D2B26] bg-white"
            >
              <option value="">실장 선택...</option>
              {managers.map((m) => (
                <option key={m.membership_id} value={m.membership_id}>{m.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkMgrId || pending.size > 0}
              onClick={bulkAssign}
              className="rounded-lg py-1.5 px-3 text-[11px] font-extrabold bg-[#C49B61] text-white disabled:opacity-40"
            >
              일괄 지정
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg py-1.5 px-2 text-[10px] font-bold text-[#7A746A] bg-white border border-[#D8D2C8]"
            >
              해제
            </button>
          </div>
        </div>
      )}

      <div className="px-5 pb-24">
        {hostesses.isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
        {all.length === 0 && !hostesses.isLoading && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">등록된 식구가 없습니다</div>
        )}

        {/* 전체 선택 헤더 · 실장 지정 안내 */}
        {all.length > 0 && managers.length > 0 && (
          <div className="flex items-center justify-between py-2 px-1 mb-1">
            <label className="flex items-center gap-2 text-[11px] font-bold text-[#7A746A]">
              <input
                type="checkbox"
                checked={selected.size === all.length && all.length > 0}
                onChange={toggleAll}
                className="w-4 h-4 accent-[#C49B61]"
              />
              전체 선택
            </label>
            <span className="text-[10px] text-[#7A746A] font-bold">
              체크 → 실장 일괄 · 오른쪽 dropdown → 개별
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {all.map((h) => {
            const cur = map.get(h.membership_id)
            const isPending = pending.has(h.membership_id)
            const isChecked = selected.has(h.membership_id)
            return (
              <div
                key={h.membership_id}
                className="bg-white rounded-2xl border border-[#D8D2C8]/60 px-3 py-2.5 flex items-center gap-2"
              >
                {managers.length > 0 && (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(h.membership_id)}
                    className="shrink-0 w-4 h-4 accent-[#C49B61]"
                  />
                )}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[14px] font-extrabold text-[#A87D45] shrink-0">
                  {h.hostess_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold truncate">{h.hostess_name}</div>
                  <div className="text-[10px] text-[#7A746A] font-semibold truncate">
                    {cur?.status === "available"
                      ? `✓ 출근 ${cur.checked_in_at ? new Date(cur.checked_in_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}`
                      : cur?.status === "in_room"
                        ? "일하는 중"
                        : cur?.status === "assigned"
                          ? "배정됨"
                          : "미출근"}
                  </div>
                  {/* R-manager-assign: 담당 실장 표시 · managerNameById lookup */}
                  <div className="text-[10px] font-bold mt-0.5">
                    <span className="text-[#7A746A]">담당: </span>
                    <span className={h.manager_membership_id ? "text-[#2D2B26] font-extrabold" : "text-red-500"}>
                      {h.manager_membership_id ? (managerNameById.get(h.manager_membership_id) ?? "?") : "미지정"}
                    </span>
                  </div>
                </div>
                {/* R-manager-assign: 개별 실장 dropdown */}
                {managers.length > 0 && (
                  <select
                    value={h.manager_membership_id ?? ""}
                    onChange={(e) => assignManager(h.membership_id, e.target.value || null)}
                    disabled={isPending}
                    className="shrink-0 rounded border border-[#D8D2C8] px-1 py-1 text-[10px] font-bold text-[#2D2B26] max-w-[70px] bg-white disabled:opacity-40"
                    title="담당 실장 변경"
                  >
                    <option value="">미지정</option>
                    {managers.map((m) => (
                      <option key={m.membership_id} value={m.membership_id}>{m.name}</option>
                    ))}
                  </select>
                )}
                <AttendanceSwitch
                  on={cur ? cur.status !== "off_duty" : false}
                  disabled={isPending}
                  onToggle={(next) => setStatus(h.membership_id, next ? "present" : "absent")}
                />
                <span style={{ display: "none" }}>{uiToDb("present")}</span>
              </div>
            )
          })}
        </div>
      </div>
      <TabBar />
    </div>
  )
}

function AttendanceSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean
  disabled?: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={cn(
        "relative w-14 h-7 rounded-full transition-colors border-2 shrink-0",
        on ? "bg-[#5FAB4E] border-[#5FAB4E]" : "bg-[#E5E1D8] border-[#D8D2C8]",
        disabled ? "opacity-40" : "",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform inline-flex items-center justify-center text-[8px] font-black",
          on ? "translate-x-7 text-[#5FAB4E]" : "translate-x-0 text-[#7A746A]",
        )}
      >
        {on ? "출근" : "결근"}
      </span>
    </button>
  )
}
