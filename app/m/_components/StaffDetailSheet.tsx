"use client"
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../_hooks/useApi"
import { cn } from "../_lib/cn"
import { fmtMoneyWon } from "../_lib/format"

/**
 * StaffDetailSheet — 스태프 세부 정산 시트.
 *
 * 사용자 요청 (2026-07-19):
 *   - 6타임을 어떤 종목으로 했는지 세부 (아우라 6: 셔츠 2, 퍼블릭 3, 하퍼 1)
 *   - 받은 금액 / 아가씨 줄 금액 / 실장 순수익 명확히
 *   - 시간당 공제 selector (0/5천/1만) — 자동 계산
 *   - AI 제안: 매출-단가 자동 검증, 세션별 override
 *
 * R-staff-detail (2026-07-19).
 */
type Session = {
  participant_id: string
  session_id: string
  store_name: string | null
  origin_store_name: string | null
  room_no: string | null
  category: string | null
  time_minutes: number | null
  price_amount: number
  manager_payout_amount: number
  hostess_payout_amount: number
  status: string
  entered_at: string | null
  left_at: string | null
  is_expected_price: boolean
  expected_price: number | null
}

type Summary = {
  total_gross: number
  total_manager_deduction: number
  total_hostess_payout: number
  total_time_minutes: number
  total_count: number
  by_store: Array<{
    store_name: string
    count: number
    categories: Record<string, number>
    display: string
  }>
  by_category: Record<string, number>
  warnings: Array<{ participant_id: string; message: string }>
}

type Resp = {
  sessions: Session[]
  summary: Summary
  deduction_per_hour: number
}

const PRESET_DEDUCTIONS = [0, 5000, 10000, 15000]

export function StaffDetailSheet({
  open,
  onClose,
  hostessId,
  hostessName,
}: {
  open: boolean
  onClose: () => void
  hostessId: string
  hostessName: string
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Resp | null>(null)
  const [deduction, setDeduction] = useState(10000)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [customDeduction, setCustomDeduction] = useState("")
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    if (!open || !hostessId) return
    let cancel = false
    setLoading(true)
    setOverrides(new Map())
    setDirty(false)
    apiFetch(`/api/manager/staff-detail/${encodeURIComponent(hostessId)}`)
      .then((r) => r.json())
      .then((j: Resp) => {
        if (cancel) return
        setData(j)
        setDeduction(j.deduction_per_hour ?? 10000)
        setCustomDeduction("")
      })
      .catch(() => toast("불러오기 실패", "error"))
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [open, hostessId, toast])

  // 실시간 미리보기 (deduction 변경 시 즉시 계산, 서버 저장 없이)
  const previewSessions = data?.sessions.map((s) => {
    const overrideDeduct = overrides.get(s.participant_id)
    const timeHours = (s.time_minutes ?? 0) / 60
    const mgrDeduct = overrideDeduct ?? Math.round(deduction * timeHours)
    const hostessPay = Math.max(0, s.price_amount - mgrDeduct)
    return { ...s, preview_manager_deduction: mgrDeduct, preview_hostess_payout: hostessPay }
  }) ?? []

  const previewTotals = previewSessions.reduce(
    (a, s) => ({
      gross: a.gross + s.price_amount,
      mgr: a.mgr + s.preview_manager_deduction,
      host: a.host + s.preview_hostess_payout,
    }),
    { gross: 0, mgr: 0, host: 0 },
  )

  function pickPreset(v: number) {
    setDeduction(v)
    setCustomDeduction("")
    setDirty(true)
    haptic(10)
  }
  function pickCustom(v: string) {
    setCustomDeduction(v)
    const n = parseInt(v, 10)
    if (Number.isFinite(n) && n >= 0) {
      setDeduction(n)
      setDirty(true)
    }
  }
  function overrideParticipant(pid: string, val: string) {
    const n = parseInt(val, 10)
    const next = new Map(overrides)
    if (Number.isFinite(n) && n >= 0) next.set(pid, n)
    else next.delete(pid)
    setOverrides(next)
    setDirty(true)
    haptic(6)
  }

  async function save() {
    if (busy || !dirty || !data) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const overridesArr = [...overrides.entries()].map(([pid, amount]) => ({
        participant_id: pid,
        manager_payout_amount: amount,
      }))
      const res = await apiFetch(`/api/manager/staff-detail/${encodeURIComponent(hostessId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deduction_per_hour: deduction,
          overrides: overridesArr,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast("저장 완료", "success")
      invalidateApi("/api/manager/settlement/summary")
      setDirty(false)
      setOverrides(new Map())
      // 재조회
      const r2 = await apiFetch(`/api/manager/staff-detail/${encodeURIComponent(hostessId)}`)
      const j2 = (await r2.json()) as Resp
      setData(j2)
    } catch (e) {
      toast(`저장 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${hostessName} · 세부 정산`}
      desc={data ? `${data.summary.total_count}타임 · ${Math.floor(data.summary.total_time_minutes / 60)}시간 ${data.summary.total_time_minutes % 60}분` : "불러오는 중..."}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-[#EFEBE3] rounded-2xl py-3 text-[13px] font-extrabold"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="flex-1 bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-2xl py-3 text-[13px] font-extrabold disabled:opacity-40"
          >
            {busy ? "저장 중..." : dirty ? "저장" : "변경 없음"}
          </button>
        </>
      }
    >
      {loading && (
        <div className="py-8 text-center text-[12px] text-[#7A746A]">불러오는 중...</div>
      )}

      {!loading && data && (
        <div className="space-y-4">
          {/* 요약 카드 */}
          <div className="bg-gradient-to-br from-[#2D2B26] to-[#1a1813] text-white rounded-2xl p-4 space-y-2">
            <div className="text-[10px] font-extrabold text-[#E4C99A] uppercase tracking-widest">
              오늘 정산 미리보기
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div>
                <div className="text-[9px] text-white/60 font-bold">받은 금액</div>
                <div className="text-[15px] font-extrabold text-white">
                  {fmtMoneyWon(previewTotals.gross)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-white/60 font-bold">실장 순수익</div>
                <div className="text-[15px] font-extrabold text-green-300">
                  +{fmtMoneyWon(previewTotals.mgr)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-white/60 font-bold">아가씨 줄 금액</div>
                <div className="text-[15px] font-extrabold text-[#E4C99A]">
                  {fmtMoneyWon(previewTotals.host)}
                </div>
              </div>
            </div>
          </div>

          {/* 매장별/종목별 breakdown */}
          {data.summary.by_store.length > 0 && (
            <div>
              <div className="text-[10px] font-extrabold text-[#7A746A] uppercase mb-1.5 tracking-wider">
                📊 매장별 · 종목별
              </div>
              <div className="bg-white border border-[#D8D2C8] rounded-2xl p-3 space-y-1.5">
                {data.summary.by_store.map((s) => (
                  <div key={s.store_name} className="text-[11px] font-bold">
                    <span className="text-[#A87D45]">{s.store_name}</span>
                    <span className="ml-1 text-[#2D2B26]">{s.count}타임</span>
                    <span className="text-[10px] text-[#7A746A] ml-2">
                      ({Object.entries(s.categories).map(([c, n]) => `${c} ${n}`).join(", ")})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 매출 불일치 경고 */}
          {data.summary.warnings.length > 0 && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 space-y-1">
              <div className="text-[11px] font-extrabold text-amber-800">
                ⚠ 매출 불일치 {data.summary.warnings.length}건
              </div>
              {data.summary.warnings.slice(0, 3).map((w, i) => (
                <div key={i} className="text-[10px] text-amber-700 font-semibold">
                  · {w.message}
                </div>
              ))}
              <div className="text-[9px] text-amber-600 mt-1">
                💡 매장 단가와 다른 금액 — 실제 확인 후 수정
              </div>
            </div>
          )}

          {/* 시간당 공제 selector */}
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] uppercase mb-1.5 tracking-wider">
              ⏱ 시간당 실장 공제 (전 세션 일괄 적용)
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESET_DEDUCTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => pickPreset(v)}
                  className={cn(
                    "rounded-xl py-2.5 text-[11px] font-extrabold border-2 transition-colors",
                    deduction === v && !customDeduction
                      ? "bg-[#C49B61] text-white border-[#A87D45]"
                      : "bg-white text-[#7A746A] border-[#D8D2C8]",
                  )}
                >
                  {v === 0 ? "0" : `${v / 1000}천`}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={customDeduction}
              onChange={(e) => pickCustom(e.target.value)}
              placeholder="커스텀 (원/시간)"
              className="w-full mt-2 bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-2.5 text-[13px] font-bold outline-none"
            />
            <div className="text-[10px] font-semibold text-[#7A746A] mt-1.5">
              💡 예: 1만 · 60분 세션 = 실장 1만 공제 · 30분 세션 = 실장 5천 공제
            </div>
          </div>

          {/* 세션별 리스트 */}
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] uppercase mb-1.5 tracking-wider">
              🗂 세션별 세부 ({previewSessions.length}건)
            </div>
            <div className="space-y-1.5">
              {previewSessions.map((s, i) => {
                const startTime = s.entered_at
                  ? new Date(s.entered_at).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "?"
                const endTime = s.left_at
                  ? new Date(s.left_at).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "진행 중"
                const overrideVal = overrides.get(s.participant_id)
                return (
                  <div
                    key={s.participant_id}
                    className={cn(
                      "bg-white border rounded-xl p-3",
                      s.is_expected_price
                        ? "border-[#D8D2C8]"
                        : "border-amber-300 bg-amber-50/40",
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] font-extrabold text-[#2D2B26]">
                        #{i + 1} · {s.store_name}
                        {s.room_no ? ` · ${s.room_no}번방` : ""}
                        {" · "}
                        <span className="text-[#A87D45]">{s.category ?? "?"}</span>
                        {" · "}
                        <span className="text-[#7A746A]">{s.time_minutes ?? 0}분</span>
                      </div>
                      <span
                        className={cn(
                          "text-[8px] font-extrabold px-1.5 py-0.5 rounded-full",
                          s.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600",
                        )}
                      >
                        {s.status === "active" ? "진행" : "종료"}
                      </span>
                    </div>
                    <div className="text-[9px] text-[#7A746A] mb-1.5">
                      {startTime} → {endTime}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div>
                        <div className="text-[8px] text-[#7A746A]">받은 금액</div>
                        <div className="text-[11px] font-extrabold text-[#2D2B26]">
                          {fmtMoneyWon(s.price_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] text-[#7A746A]">실장</div>
                        <input
                          type="number"
                          value={overrideVal ?? s.preview_manager_deduction}
                          onChange={(e) =>
                            overrideParticipant(s.participant_id, e.target.value)
                          }
                          className={cn(
                            "w-full text-[11px] font-extrabold text-center rounded outline-none py-0.5",
                            overrideVal !== undefined
                              ? "bg-blue-100 text-blue-800 border border-blue-300"
                              : "bg-transparent text-green-700",
                          )}
                        />
                      </div>
                      <div>
                        <div className="text-[8px] text-[#7A746A]">아가씨</div>
                        <div className="text-[11px] font-extrabold text-[#A87D45]">
                          {fmtMoneyWon(s.preview_hostess_payout)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {previewSessions.length === 0 && (
                <div className="text-center text-[11px] text-[#7A746A] py-4">
                  오늘 세션 없음
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}
