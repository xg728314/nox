"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

type ClosingReport = {
  id: string
  business_day_id: string
  status: string
  summary: {
    total_sessions: number
    gross_total: number
    tc_total: number
    manager_total: number
    hostess_total: number
    margin_total: number
    order_total: number
    participant_total: number
  }
  notes: string | null
  created_at: string
  confirmed_at: string
}

export default function OperatingDaysPage() {
  const router = useRouter()
  const profile = useCurrentProfile()
  const role = profile?.role ?? ""
  const [businessDayId, setBusinessDayId] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState("")
  const [draftWarning, setDraftWarning] = useState<{ count: number; session_ids: string[] } | null>(null)
  const [result, setResult] = useState<{ business_date: string; status: string; closing_report: ClosingReport | null } | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reauthCode, setReauthCode] = useState("")
  const [reauthLoading, setReauthLoading] = useState(false)
  const [reauthError, setReauthError] = useState("")
  const [reauthPendingForce, setReauthPendingForce] = useState(false)

  useEffect(() => {
    fetchBusinessDay()
  }, [])

  async function fetchBusinessDay() {
    try {
      const res = await apiFetch("/api/rooms")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setBusinessDayId(data.business_day_id ?? null)
      }
    } catch {
      setError("영업일 정보를 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleClose(force = false) {
    if (!businessDayId) return

    setClosing(true)
    setError("")
    if (force) setDraftWarning(null)

    try {
      const res = await apiFetch("/api/operating-days/close", {
        method: "POST",
        body: JSON.stringify({
          business_day_id: businessDayId,
          notes: notes || undefined,
          force: force || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 401 && data.error === "REAUTH_REQUIRED") {
          setReauthPendingForce(force)
          setReauthCode("")
          setReauthError("")
          setReauthOpen(true)
          return
        }
        if (data.error === "DRAFT_RECEIPTS_EXIST") {
          setDraftWarning({
            count: data.draft_count,
            session_ids: data.draft_session_ids ?? [],
          })
        } else if (data.error === "ACTIVE_SESSIONS_EXIST") {
          setError(data.message || "활성 세션이 남아있습니다. 모든 세션을 종료한 후 마감하세요.")
        } else if (data.error === "ROLE_FORBIDDEN") {
          setError("사장(owner)만 영업일을 마감할 수 있습니다.")
        } else {
          setError(data.message || "마감 처리에 실패했습니다.")
        }
        return
      }

      setDraftWarning(null)
      setResult({
        business_date: data.business_date ?? "",
        status: data.status ?? "",
        closing_report: data.closing_report ?? null,
      })
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setClosing(false)
    }
  }

  async function handleReauthSubmit() {
    if (!/^\d{6}$/.test(reauthCode)) {
      setReauthError("6자리 인증 코드를 입력하세요.")
      return
    }
    setReauthLoading(true)
    setReauthError("")
    try {
      const res = await apiFetch("/api/auth/reauth", {
        method: "POST",
        body: JSON.stringify({
          action_class: "financial_write",
          code: reauthCode,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.error === "INVALID_CODE") {
          setReauthError("인증 코드가 올바르지 않습니다.")
        } else if (data.error === "MFA_REQUIRED") {
          setReauthError("이 작업은 MFA가 활성화된 계정에서만 수행할 수 있습니다.")
        } else if (data.error === "RATE_LIMITED") {
          setReauthError(data.message || "잠시 후 다시 시도하세요.")
        } else if (data.error === "BAD_REQUEST") {
          setReauthError(data.message || "요청 형식이 올바르지 않습니다.")
        } else {
          setReauthError(data.message || "재인증에 실패했습니다.")
        }
        return
      }
      // success: close modal, retry the original close action
      setReauthOpen(false)
      setReauthCode("")
      const force = reauthPendingForce
      setReauthPendingForce(false)
      await handleClose(force)
    } catch {
      setReauthError("서버 오류가 발생했습니다.")
    } finally {
      setReauthLoading(false)
    }
  }

  function handleReauthCancel() {
    setReauthOpen(false)
    setReauthCode("")
    setReauthError("")
    setReauthPendingForce(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 카운터</button>
          <span className="font-semibold">영업일 마감</span>
          <div className="text-xs text-slate-400">{role === "owner" ? "사장" : "실장"}</div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 영업일 없음 */}
        {!businessDayId && !result && (
          <div className="px-4 py-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📅</div>
              <p className="text-slate-500 text-sm">오늘의 영업일이 없습니다.</p>
              <p className="text-slate-600 text-xs mt-1">입실(체크인)을 하면 자동으로 생성됩니다.</p>
            </div>
          </div>
        )}

        {/* 마감 전 */}
        {businessDayId && !result && (
          <div className="px-4 py-4 space-y-4">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="text-xs text-slate-400">영업일 ID</div>
              <div className="mt-1 text-sm font-mono text-slate-200">{businessDayId.slice(0, 8)}</div>
            </div>

            {role === "owner" && (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <label className="block text-xs text-slate-400 mb-2">메모 (선택)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-transparent border border-white/10 rounded-xl p-3 text-sm text-white outline-none resize-none"
                    rows={3}
                    placeholder="마감 메모를 입력하세요..."
                  />
                </div>

                {/* draft 경고 */}
                {draftWarning && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400 text-lg">⚠</span>
                      <span className="text-sm font-medium text-amber-300">미확정 정산 경고</span>
                    </div>
                    <p className="text-sm text-amber-200">
                      아직 확정되지 않은 정산이 <span className="font-bold">{draftWarning.count}건</span> 있습니다.
                    </p>
                    <p className="text-xs text-slate-400">
                      정산을 확정한 후 마감하는 것을 권장합니다. 강제 마감 시 draft 상태로 마감됩니다.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => router.push("/owner/settlement")}
                        className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-all"
                      >
                        정산 확인하기
                      </button>
                      <button
                        onClick={() => handleClose(true)}
                        disabled={closing}
                        className="flex-1 py-2.5 rounded-xl bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {closing ? "처리 중..." : "강제 마감"}
                      </button>
                    </div>
                  </div>
                )}

                {!draftWarning && (
                  <button
                    onClick={() => handleClose()}
                    disabled={closing}
                    className="w-full h-14 rounded-2xl bg-[linear-gradient(90deg,#f97316,#ef4444)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(239,68,68,0.3)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                  >
                    {closing ? "마감 처리 중..." : "영업일 마감"}
                  </button>
                )}
              </>
            )}

            {role === "manager" && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
                <div className="text-amber-300 text-sm">영업일 마감은 사장(owner)만 가능합니다.</div>
                <div className="text-slate-500 text-xs mt-1">현재 영업일이 진행 중입니다.</div>
              </div>
            )}
          </div>
        )}

        {/* 마감 완료 */}
        {result && (
          <div className="px-4 py-4 space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]" />
                <div>
                  <div className="text-sm font-medium text-emerald-300">마감 완료</div>
                  <div className="text-xs text-slate-400 mt-1">영업일: {result.business_date}</div>
                </div>
              </div>
            </div>

            {result.closing_report?.summary && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                <div className="text-sm font-medium text-slate-300">마감 요약</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "총 세션", value: result.closing_report.summary.total_sessions, unit: "건" },
                    { label: "총 매출", value: result.closing_report.summary.gross_total, unit: "원", format: true },
                    { label: "TC", value: result.closing_report.summary.tc_total, unit: "원", format: true },
                    { label: "실장 정산", value: result.closing_report.summary.manager_total, unit: "원", format: true },
                    { label: "스태프 정산", value: result.closing_report.summary.hostess_total, unit: "원", format: true },
                    { label: "마진", value: result.closing_report.summary.margin_total, unit: "원", format: true },
                    { label: "주문 합계", value: result.closing_report.summary.order_total, unit: "원", format: true },
                    { label: "참여 합계", value: result.closing_report.summary.participant_total, unit: "원", format: true },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-white/[0.04] p-3">
                      <div className="text-xs text-slate-500">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-200">
                        {item.format ? `₩${(item.value ?? 0).toLocaleString()}` : `${item.value ?? 0}${item.unit}`}
                      </div>
                    </div>
                  ))}
                </div>
                {result.closing_report.notes && (
                  <div className="rounded-xl bg-white/[0.04] p-3">
                    <div className="text-xs text-slate-500">메모</div>
                    <div className="mt-1 text-sm text-slate-300">{result.closing_report.notes}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {reauthOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-cyan-300/20 bg-[#0A1222] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
            <div className="text-sm font-semibold text-cyan-200">재인증 필요</div>
            <p className="mt-1 text-xs text-slate-400">
              영업일 마감은 민감 작업입니다. 인증 앱의 6자리 코드를 입력하세요.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-[#030814] px-3 py-3">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={reauthCode}
                onChange={(e) => setReauthCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && handleReauthSubmit()}
                autoFocus
                placeholder="000000"
                className="w-full bg-transparent text-base tracking-[0.4em] text-white outline-none placeholder:text-slate-600"
              />
            </div>
            {reauthError && (
              <div className="mt-3 text-xs text-red-400">{reauthError}</div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleReauthCancel}
                disabled={reauthLoading}
                className="flex-1 h-10 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-slate-300 hover:bg-white/[0.07] disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleReauthSubmit}
                disabled={reauthLoading}
                className="flex-1 h-10 rounded-xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-sm font-medium text-white disabled:opacity-50"
              >
                {reauthLoading ? "확인 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
