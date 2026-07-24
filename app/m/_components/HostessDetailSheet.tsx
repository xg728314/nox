"use client"
import { useEffect, useState, useCallback } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * R-hostess-detail (2026-07-25): 아가씨 클릭 시 상세 sheet.
 *   - 일정 관리표 (오늘 이후 휴가·오프 리스트 + 신규 추가 form)
 *   - 지급 방식 (현금/계좌) 표시 (계좌 = 은행·계좌번호 · 예금주 공유)
 *
 * 데이터 소스:
 *   - 일정  : /api/manager/hostesses/[id]/schedule (GET/POST/DELETE)
 *            migration 172 apply 후 정상 · 미apply 시 안내 메시지
 *   - 지급  : /api/manager/hostesses/[id]/info (기존 API 재사용)
 */

type ScheduleType = "vacation" | "off" | "sick" | "other"
type Schedule = {
  id: string
  hostess_membership_id: string
  store_uuid: string
  schedule_type: ScheduleType
  start_date: string
  end_date: string
  note: string | null
  created_at: string
}
type PayoutInfo = {
  method: "cash" | "account"
  bank_name: string | null
  account_number: string | null
  holder_name: string | null
}

const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  vacation: "휴가",
  off: "오프",
  sick: "병가",
  other: "기타",
}
const SCHEDULE_TYPE_COLOR: Record<ScheduleType, string> = {
  vacation: "#DE3A7B",
  off: "#8B5CF6",
  sick: "#DC2626",
  other: "#7A746A",
}

export function HostessDetailSheet({
  open,
  onClose,
  hostessId,
  hostessName,
}: {
  open: boolean
  onClose: () => void
  hostessId: string | null
  hostessName: string
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [migrationPending, setMigrationPending] = useState(false)
  const [payout, setPayout] = useState<PayoutInfo | null>(null)
  const [loading, setLoading] = useState(false)

  // 신규 일정 form
  const [newType, setNewType] = useState<ScheduleType>("off")
  const [newStart, setNewStart] = useState<string>("")
  const [newEnd, setNewEnd] = useState<string>("")
  const [newNote, setNewNote] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hostessId) return
    setLoading(true)
    try {
      const [schRes, infoRes] = await Promise.all([
        apiFetch(`/api/manager/hostesses/${encodeURIComponent(hostessId)}/schedule`),
        apiFetch(`/api/manager/hostesses/${encodeURIComponent(hostessId)}/info`),
      ])
      const schJson = await schRes.json().catch(() => ({}))
      setSchedules(schJson.schedules ?? [])
      setMigrationPending(Boolean(schJson.migration_pending))
      const infoJson = await infoRes.json().catch(() => ({}))
      if (infoJson.payout) {
        setPayout({
          method: infoJson.payout.method ?? "cash",
          bank_name: infoJson.payout.bank_name ?? null,
          account_number: infoJson.payout.account_number ?? null,
          holder_name: infoJson.payout.holder_name ?? null,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [hostessId])

  useEffect(() => {
    if (open && hostessId) {
      // 초기값 세팅 (오늘)
      const today = new Date().toISOString().slice(0, 10)
      setNewStart(today)
      setNewEnd(today)
      setNewType("off")
      setNewNote("")
      setError(null)
      load()
    }
  }, [open, hostessId, load])

  async function addSchedule() {
    if (!hostessId || submitting) return
    if (!newStart || !newEnd) { setError("시작·종료 날짜를 선택해주세요."); return }
    if (newEnd < newStart) { setError("종료일이 시작일보다 이전입니다."); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/manager/hostesses/${encodeURIComponent(hostessId)}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_type: newType,
          start_date: newStart,
          end_date: newEnd,
          note: newNote || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { message?: string; error?: string }
        if (j.error === "MIGRATION_PENDING") {
          setMigrationPending(true)
          setError("일정 기능은 관리자가 DB migration 172 를 적용한 후 활성됩니다.")
        } else {
          setError(j.message ?? j.error ?? `HTTP ${res.status}`)
        }
        return
      }
      // 초기화 · 재조회
      setNewNote("")
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteSchedule(id: string) {
    if (!hostessId) return
    if (!confirm("이 일정을 삭제하시겠습니까?")) return
    try {
      const res = await apiFetch(`/api/manager/hostesses/${encodeURIComponent(hostessId)}/schedule?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (res.ok) await load()
    } catch { /* silent */ }
  }

  if (!open) return null

  const today = new Date().toISOString().slice(0, 10)
  const isOffToday = schedules.some((s) => s.start_date <= today && s.end_date >= today)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed left-0 right-0 bottom-0 bg-white rounded-t-2xl z-50 max-h-[92dvh] overflow-y-auto"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
      >
        <div className="sticky top-0 bg-white border-b border-[#EDE7DA] px-4 py-3 flex items-center gap-2 z-10">
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-extrabold text-[#2D2B26] truncate">{hostessName}</div>
            <div className="text-[10px] font-bold text-[#7A746A]">일정 · 지급 방식</div>
          </div>
          {isOffToday && (
            <span className="text-[10px] font-black rounded-full px-2 py-1 bg-[#DE3A7B] text-white shrink-0">
              ⚠ 오늘 출근 안함
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="닫기" className="text-[18px] text-[#7A746A] px-2">
            ✕
          </button>
        </div>

        <div className="px-4 py-3">
          {/* ── 지급 방식 ── */}
          <section className="mb-4">
            <div className="text-[11px] font-black text-[#7A746A] uppercase tracking-wider mb-2">
              💳 지급 방식
            </div>
            {loading && !payout && (
              <div className="text-[11px] text-[#7A746A] py-2">불러오는 중…</div>
            )}
            {payout && (
              <div className="bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-black px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: payout.method === "cash" ? "#D97757" : "#3B82F6",
                      color: "#ffffff",
                    }}
                  >
                    {payout.method === "cash" ? "💵 현금" : "💳 계좌"}
                  </span>
                  <span className="text-[11px] font-bold text-[#7A746A]">
                    (실장 사이 공유 정보 · 정산 시 참고)
                  </span>
                </div>
                {payout.method === "account" && (
                  <div className="pl-1 text-[12px] font-bold text-[#2D2B26]">
                    {payout.bank_name || "은행 미입력"} · {payout.account_number || "계좌 미입력"}
                    {payout.holder_name && <span className="text-[#7A746A] font-semibold"> · 예금주 {payout.holder_name}</span>}
                  </div>
                )}
                {payout.method === "cash" && (
                  <div className="pl-1 text-[11px] font-bold text-[#7A746A]">현금 수령</div>
                )}
              </div>
            )}
          </section>

          {/* ── 일정 관리표 ── */}
          <section>
            <div className="text-[11px] font-black text-[#7A746A] uppercase tracking-wider mb-2">
              📅 일정 관리 (휴가 · 오프)
            </div>
            {migrationPending && (
              <div className="text-[10px] font-bold text-[#B22563] bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-2">
                ⚠ 일정 기능은 관리자가 database migration 172 (hostess_schedules) 를 apply 한 후 활성됩니다.
              </div>
            )}

            {/* 신규 추가 form */}
            <div className="bg-white border border-[#D8D2C8] rounded-xl p-3 mb-2 flex flex-col gap-2">
              <div className="text-[11px] font-bold text-[#2D2B26]">신규 등록</div>
              <div className="flex gap-1.5 items-center overflow-x-auto no-scrollbar">
                {(["vacation", "off", "sick", "other"] as ScheduleType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 border text-[11px] font-extrabold",
                      newType === t
                        ? "text-white"
                        : "bg-white text-[#2D2B26] border-[#D8D2C8]",
                    )}
                    style={newType === t ? { backgroundColor: SCHEDULE_TYPE_COLOR[t], borderColor: SCHEDULE_TYPE_COLOR[t] } : undefined}
                  >
                    {SCHEDULE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={newStart}
                  onChange={(e) => { setNewStart(e.target.value); if (newEnd < e.target.value) setNewEnd(e.target.value) }}
                  className="flex-1 min-w-0 border border-[#D8D2C8] rounded-lg px-2 py-1.5 text-[12px] font-bold text-[#2D2B26]"
                />
                <span className="text-[10px] text-[#7A746A]">~</span>
                <input
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  min={newStart || undefined}
                  className="flex-1 min-w-0 border border-[#D8D2C8] rounded-lg px-2 py-1.5 text-[12px] font-bold text-[#2D2B26]"
                />
              </div>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="메모 (선택)"
                className="w-full border border-[#D8D2C8] rounded-lg px-2 py-1.5 text-[12px] text-[#2D2B26] placeholder:text-[#B0A99B]"
              />
              {error && (
                <div className="text-[11px] font-bold text-red-700">{error}</div>
              )}
              <button
                type="button"
                onClick={addSchedule}
                disabled={submitting || migrationPending}
                className="w-full rounded-lg bg-[#2D2B26] text-white text-[12px] font-extrabold py-2 disabled:opacity-40"
              >
                {submitting ? "저장 중…" : "+ 일정 등록"}
              </button>
            </div>

            {/* 등록된 일정 리스트 */}
            <div className="flex flex-col gap-1.5">
              {loading && schedules.length === 0 && (
                <div className="text-[11px] text-[#7A746A] py-2">불러오는 중…</div>
              )}
              {!loading && schedules.length === 0 && !migrationPending && (
                <div className="text-[11px] text-[#7A746A] py-3 text-center">
                  등록된 일정이 없습니다.
                </div>
              )}
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 bg-[#FAF5EC] border border-[#D8D2C8] rounded-lg px-2.5 py-1.5"
                >
                  <span
                    className="text-[9px] font-black rounded px-1.5 py-0.5 shrink-0"
                    style={{
                      backgroundColor: SCHEDULE_TYPE_COLOR[s.schedule_type as ScheduleType] ?? "#7A746A",
                      color: "#ffffff",
                    }}
                  >
                    {SCHEDULE_TYPE_LABEL[s.schedule_type as ScheduleType] ?? s.schedule_type}
                  </span>
                  <span className="text-[11px] font-bold text-[#2D2B26]">
                    {s.start_date === s.end_date
                      ? s.start_date
                      : `${s.start_date} ~ ${s.end_date}`}
                  </span>
                  {s.note && (
                    <span className="text-[10px] font-semibold text-[#7A746A] truncate flex-1">
                      {s.note}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteSchedule(s.id)}
                    className="ml-auto text-[10px] font-bold text-[#B22563] px-1.5 py-0.5 rounded border border-[#DE3A7B]/40"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
