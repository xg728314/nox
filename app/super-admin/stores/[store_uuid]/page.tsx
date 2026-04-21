"use client"

/**
 * /super-admin/stores/[store_uuid] — per-store monitoring.
 * super_admin-only (middleware-gated). Three read-only tabs:
 *   - 운영 현황 : rooms grid + today KPIs
 *   - owner 정산: same aggregation as owner/settlement, scoped to target store
 *   - manager 정산: per-manager aggregates
 * Polls every 15s while on the 운영 현황 tab for near-real-time status.
 */

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type Tab = "ops" | "owner" | "manager"

type SessionInfo = {
  id: string
  status: string
  started_at: string
  ended_at: string | null
  participant_count: number
  gross_total: number
  participant_total: number
  order_total: number
  manager_name: string | null
  customer_name_snapshot: string | null
  customer_party_size: number
}
type RoomInfo = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session: SessionInfo | null
  closed_session: SessionInfo | null
}

type MonitorData = {
  store: { id: string; store_name: string; store_code: string | null; floor: number | null; is_active: boolean }
  business_day: { id: string; business_date: string; status: string; opened_at: string | null; closed_at: string | null } | null
  rooms: RoomInfo[]
  kpis_today: {
    total_sessions: number
    gross_total: number
    finalized_count: number
    draft_count: number
    unsettled_count: number
  }
}

type OwnerSettlementData = {
  store_uuid: string
  business_day_id: string | null
  business_date: string | null
  business_day_status: string | null
  summary: {
    total_sessions: number
    tc_count: number
    liquor_sales: number
    owner_revenue: number
    waiter_tips: number
    purchases: number
    gross_total: number
    owner_margin: number
    finalized_count: number
    draft_count: number
    unsettled_count: number
  } | null
  sessions: {
    session_id: string
    room_name: string | null
    session_status: string
    tc_count: number
    liquor_sales: number
    waiter_tips: number
    purchases: number
    gross_total: number | null
    owner_margin: number | null
    receipt_status: string | null
  }[]
}

type ManagerSettlementData = {
  store_uuid: string
  business_day_id: string | null
  managers: {
    manager_membership_id: string
    manager_name: string
    hostess_count: number
    settlement_sessions: number
    total_gross: number
    total_manager_amount: number
    total_hostess_amount: number
    finalized_count: number
    draft_count: number
  }[]
}

function fmtWon(n: number | null | undefined) {
  const v = typeof n === "number" ? n : 0
  if (v === 0) return "0원"
  if (v >= 10_000) return `${Math.floor(v / 10_000).toLocaleString()}만 ${((v % 10_000)).toLocaleString()}원`.replace(" 0원", "")
  return `${v.toLocaleString()}원`
}

function sessionStatusBadge(room: RoomInfo) {
  if (room.session?.status === "active") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">운영중</span>
  }
  if (room.closed_session) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">최근 마감</span>
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-500">비어있음</span>
}

type ForceCloseTarget = {
  session_id: string
  room_name: string
  started_at: string
  manager_name: string | null
  gross_total: number
  participant_count: number
} | null

type RecoverTarget = {
  session_id: string
  room_name: string
} | null

type RecoverReport = {
  ok: boolean
  session_id: string
  current_status: string
  recoverable: boolean
  issues: string[]
  next_actions: string[]
  detail: {
    business_day: { id: string; status: string; business_date: string } | null
    active_participant_count: number
    unresolved_participants: { id: string; external_name: string | null; category: string | null; time_minutes: number | null }[]
    invalid_price_orders: { id: string; item_name: string | null }[]
    mismatch_price_orders: { id: string; item_name: string | null; store_price: number | null; sale_price: number | null }[]
  }
}

type PriceOverrideTarget = {
  session_id: string
  room_name: string
} | null

export default function SuperAdminStorePage({
  params,
}: {
  params: Promise<{ store_uuid: string }>
}) {
  const { store_uuid } = use(params)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("ops")
  const [monitor, setMonitor] = useState<MonitorData | null>(null)
  const [ownerData, setOwnerData] = useState<OwnerSettlementData | null>(null)
  const [managerData, setManagerData] = useState<ManagerSettlementData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  // Force-close modal state (super_admin write action)
  const [forceTarget, setForceTarget] = useState<ForceCloseTarget>(null)
  const [forceReason, setForceReason] = useState("")
  const [forceSubmitting, setForceSubmitting] = useState(false)
  const [forceError, setForceError] = useState("")
  const [forceSuccess, setForceSuccess] = useState("")

  // Participant-cleanup modal state
  const [cleanTarget, setCleanTarget] = useState<ForceCloseTarget>(null)
  const [cleanReason, setCleanReason] = useState("")
  const [cleanSubmitting, setCleanSubmitting] = useState(false)
  const [cleanError, setCleanError] = useState("")
  const [cleanMsg, setCleanMsg] = useState("")

  // Price override modal state
  const [priceTarget, setPriceTarget] = useState<PriceOverrideTarget>(null)
  const [priceAmount, setPriceAmount] = useState<string>("")
  const [priceReason, setPriceReason] = useState("")
  const [priceSubmitting, setPriceSubmitting] = useState(false)
  const [priceError, setPriceError] = useState("")
  const [priceMsg, setPriceMsg] = useState("")

  // Recovery diagnostic state
  const [recoverTarget, setRecoverTarget] = useState<RecoverTarget>(null)
  const [recoverReason, setRecoverReason] = useState("")
  const [recoverSubmitting, setRecoverSubmitting] = useState(false)
  const [recoverError, setRecoverError] = useState("")
  const [recoverReport, setRecoverReport] = useState<RecoverReport | null>(null)

  async function fetchMonitor() {
    try {
      const res = await apiFetch(`/api/super-admin/stores/${store_uuid}`, { cache: "no-store" })
      if (res.status === 401) { router.push("/login"); return }
      if (res.status === 403) { setError("권한이 없습니다."); setLoading(false); return }
      if (!res.ok) { setError("모니터 로드 실패"); setLoading(false); return }
      const body = await res.json()
      setMonitor(body)
      setError("")
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  async function fetchOwner() {
    try {
      const res = await apiFetch(`/api/super-admin/stores/${store_uuid}/settlement/owner`, { cache: "no-store" })
      if (!res.ok) return
      const body = await res.json()
      setOwnerData(body)
    } catch { /* ignore */ }
  }

  async function fetchManager() {
    try {
      const res = await apiFetch(`/api/super-admin/stores/${store_uuid}/settlement/manager`, { cache: "no-store" })
      if (!res.ok) return
      const body = await res.json()
      setManagerData(body)
    } catch { /* ignore */ }
  }

  function openForceClose(room: RoomInfo) {
    if (!room.session || room.session.status !== "active") return
    setForceReason("")
    setForceError("")
    setForceSuccess("")
    setForceTarget({
      session_id: room.session.id,
      room_name: room.room_name || room.room_no,
      started_at: room.session.started_at,
      manager_name: room.session.manager_name,
      gross_total: room.session.gross_total,
      participant_count: room.session.participant_count,
    })
  }

  async function submitForceClose() {
    if (!forceTarget) return
    const trimmed = forceReason.trim()
    if (trimmed.length < 3) {
      setForceError("사유는 최소 3자 이상 입력해주세요.")
      return
    }
    setForceSubmitting(true)
    setForceError("")
    try {
      const res = await apiFetch(
        `/api/super-admin/stores/${store_uuid}/sessions/${forceTarget.session_id}/force-close`,
        {
          method: "POST",
          body: JSON.stringify({ reason: trimmed }),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setForceError(body?.message || "강제 종료에 실패했습니다.")
        return
      }
      setForceSuccess(`세션이 강제 종료되었습니다. (참가자 ${body.participants_closed_count ?? 0}명 자동 left 처리)`)
      // Refresh the ops snapshot so the room flips to closed/empty immediately
      setTimeout(async () => {
        setForceTarget(null)
        setForceSuccess("")
        await fetchMonitor()
      }, 1600)
    } catch {
      setForceError("서버 오류가 발생했습니다.")
    } finally {
      setForceSubmitting(false)
    }
  }

  function openClean(room: RoomInfo) {
    if (!room.session || room.session.status !== "active") return
    setCleanReason(""); setCleanError(""); setCleanMsg("")
    setCleanTarget({
      session_id: room.session.id,
      room_name: room.room_name || room.room_no,
      started_at: room.session.started_at,
      manager_name: room.session.manager_name,
      gross_total: room.session.gross_total,
      participant_count: room.session.participant_count,
    })
  }

  async function submitClean() {
    if (!cleanTarget) return
    const trimmed = cleanReason.trim()
    if (trimmed.length < 3) { setCleanError("사유는 최소 3자 이상 입력해주세요."); return }
    setCleanSubmitting(true); setCleanError("")
    try {
      const res = await apiFetch(
        `/api/super-admin/stores/${store_uuid}/sessions/${cleanTarget.session_id}/participants/force-clean`,
        { method: "POST", body: JSON.stringify({ reason: trimmed }) }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setCleanError(body?.message || "참가자 정리 실패"); return }
      setCleanMsg(body?.message || "정리 완료")
      setTimeout(async () => {
        setCleanTarget(null); setCleanMsg("")
        await fetchMonitor()
      }, 1400)
    } catch {
      setCleanError("서버 오류")
    } finally {
      setCleanSubmitting(false)
    }
  }

  function openPriceOverride(room: RoomInfo) {
    if (!room.session || room.session.status !== "active") return
    setPriceAmount(""); setPriceReason(""); setPriceError(""); setPriceMsg("")
    setPriceTarget({ session_id: room.session.id, room_name: room.room_name || room.room_no })
  }

  async function submitPriceOverride() {
    if (!priceTarget) return
    const trimmedReason = priceReason.trim()
    if (trimmedReason.length < 3) { setPriceError("사유는 최소 3자 이상 입력해주세요."); return }
    const n = Number(priceAmount)
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) {
      setPriceError("총 금액은 0 이상 정수여야 합니다."); return
    }
    setPriceSubmitting(true); setPriceError("")
    try {
      const res = await apiFetch(
        `/api/super-admin/stores/${store_uuid}/sessions/${priceTarget.session_id}/override-price`,
        { method: "POST", body: JSON.stringify({ total_amount: n, reason: trimmedReason }) }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setPriceError(body?.message || "가격 수정 실패"); return }
      setPriceMsg(body?.message || "가격 수정 완료")
      setTimeout(async () => {
        setPriceTarget(null); setPriceMsg("")
        await fetchMonitor()
      }, 1600)
    } catch {
      setPriceError("서버 오류")
    } finally {
      setPriceSubmitting(false)
    }
  }

  function openRecover(room: RoomInfo) {
    if (!room.session || room.session.status !== "active") return
    setRecoverReason(""); setRecoverError(""); setRecoverReport(null)
    setRecoverTarget({ session_id: room.session.id, room_name: room.room_name || room.room_no })
  }

  async function submitRecover() {
    if (!recoverTarget) return
    const trimmed = recoverReason.trim()
    if (trimmed.length < 3) { setRecoverError("사유는 최소 3자 이상 입력해주세요."); return }
    setRecoverSubmitting(true); setRecoverError("")
    try {
      const res = await apiFetch(
        `/api/super-admin/stores/${store_uuid}/sessions/${recoverTarget.session_id}/recover`,
        { method: "POST", body: JSON.stringify({ reason: trimmed }) }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setRecoverError(body?.message || "상태 진단 실패"); return }
      setRecoverReport(body as RecoverReport)
    } catch {
      setRecoverError("서버 오류")
    } finally {
      setRecoverSubmitting(false)
    }
  }

  // Monitor always loaded; others lazy on tab change
  useEffect(() => {
    fetchMonitor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store_uuid])

  useEffect(() => {
    if (tab === "ops") {
      const i = setInterval(fetchMonitor, 15_000)
      return () => clearInterval(i)
    }
    if (tab === "owner" && !ownerData) fetchOwner()
    if (tab === "manager" && !managerData) fetchManager()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, store_uuid])

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white antialiased">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/super-admin" className="text-slate-400 hover:text-white text-sm">←</Link>
            <span className="text-base font-bold tracking-tight">
              {monitor?.store.store_name ?? "매장 상세"}
            </span>
            {monitor?.store.floor != null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">
                {monitor.store.floor}층
              </span>
            )}
            {monitor?.business_day && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                monitor.business_day.status === "open"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-slate-500/10 text-slate-400"
              }`}>
                {monitor.business_day.status === "open" ? "영업중" : "마감"}
                {" · "}
                {monitor.business_day.business_date}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
              SUPER ADMIN (READ ONLY)
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 pb-2 flex gap-1">
          {([["ops", "운영 현황"], ["owner", "owner 정산"], ["manager", "manager 정산"]] as const).map(
            ([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === k
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white border border-transparent"
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading && !monitor && (
        <div className="px-4 py-10 text-center text-slate-500 text-sm">로딩 중…</div>
      )}

      {/* OPS TAB */}
      {tab === "ops" && monitor && (
        <div className="px-4 py-4 space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Kpi label="오늘 세션" value={monitor.kpis_today.total_sessions.toString()} />
            <Kpi label="오늘 매출" value={fmtWon(monitor.kpis_today.gross_total)} accent="emerald" />
            <Kpi label="확정" value={monitor.kpis_today.finalized_count.toString()} accent="emerald" />
            <Kpi label="Draft" value={monitor.kpis_today.draft_count.toString()} accent="cyan" />
            <Kpi
              label="미정산"
              value={monitor.kpis_today.unsettled_count.toString()}
              accent={monitor.kpis_today.unsettled_count > 0 ? "amber" : undefined}
            />
          </div>

          {/* Room grid */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 mb-2">룸 상태 ({monitor.rooms.length}개)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {monitor.rooms.map((room) => (
                <div
                  key={room.id}
                  className={`rounded-xl border p-3 ${
                    room.session?.status === "active"
                      ? "border-cyan-500/30 bg-cyan-500/5"
                      : room.closed_session
                      ? "border-white/10 bg-white/[0.04]"
                      : "border-white/5 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="text-sm font-semibold">{room.room_name || room.room_no}</div>
                    {sessionStatusBadge(room)}
                  </div>
                  {room.session && (
                    <div className="mt-2 space-y-0.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">참가자</span>
                        <span>{room.session.participant_count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">매출</span>
                        <span className="text-emerald-300 font-semibold">{fmtWon(room.session.gross_total)}</span>
                      </div>
                      {room.session.manager_name && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">실장</span>
                          <span className="text-slate-300">{room.session.manager_name}</span>
                        </div>
                      )}
                      {/* super_admin write actions — only rendered for active
                          sessions. API also enforces this; UI is the first
                          gate, API is the authoritative one. Recovery flow:
                          진단 → 참가자 정리 → 가격 수정 → 강제 종료 */}
                      {room.session.status === "active" && (
                        <div className="mt-2 space-y-1">
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              onClick={() => openRecover(room)}
                              className="text-[10px] px-1.5 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors"
                              title="세션 상태 진단 — force-close 가능 여부 확인"
                            >
                              상태 복구
                            </button>
                            <button
                              onClick={() => openClean(room)}
                              className="text-[10px] px-1.5 py-1 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                              title="활성 참가자 전체 left 처리"
                            >
                              참가자 정리
                            </button>
                            <button
                              onClick={() => openPriceOverride(room)}
                              className="text-[10px] px-1.5 py-1 rounded border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-colors"
                              title="가격 미설정 주문의 store_price/sale_price 복구"
                            >
                              가격 수정
                            </button>
                            <button
                              onClick={() => openForceClose(room)}
                              className="text-[10px] px-1.5 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors"
                              title="장애 복구 전용 — 감사 로그에 기록됩니다"
                            >
                              강제 종료
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!room.session && room.closed_session && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      마감 매출 <span className="text-slate-300 font-semibold">{fmtWon(room.closed_session.gross_total)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* OWNER SETTLEMENT TAB */}
      {tab === "owner" && (
        <div className="px-4 py-4 space-y-4">
          {!ownerData && <div className="text-slate-500 text-sm">로딩 중…</div>}
          {ownerData?.summary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kpi label="세션" value={ownerData.summary.total_sessions.toString()} />
                <Kpi label="TC 건수" value={ownerData.summary.tc_count.toString()} />
                <Kpi label="총매출" value={fmtWon(ownerData.summary.gross_total)} accent="emerald" />
                <Kpi label="사장 마진" value={fmtWon(ownerData.summary.owner_margin)} accent="emerald" />
                <Kpi label="양주 매출" value={fmtWon(ownerData.summary.liquor_sales)} accent="cyan" />
                <Kpi label="웨이터팁" value={fmtWon(ownerData.summary.waiter_tips)} />
                <Kpi label="사입" value={fmtWon(ownerData.summary.purchases)} />
                <Kpi
                  label="미정산"
                  value={ownerData.summary.unsettled_count.toString()}
                  accent={ownerData.summary.unsettled_count > 0 ? "amber" : undefined}
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <div className="px-4 py-2 text-xs font-semibold text-slate-400 border-b border-white/5">
                  세션별 정산 (영업일 {ownerData.business_date ?? "—"})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-white/5">
                        <th className="px-3 py-2">룸</th>
                        <th className="px-3 py-2">세션</th>
                        <th className="px-3 py-2">TC</th>
                        <th className="px-3 py-2 text-right">양주</th>
                        <th className="px-3 py-2 text-right">웨이터팁</th>
                        <th className="px-3 py-2 text-right">사입</th>
                        <th className="px-3 py-2 text-right">총매출</th>
                        <th className="px-3 py-2 text-right">마진</th>
                        <th className="px-3 py-2">영수증</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownerData.sessions.map((s) => (
                        <tr key={s.session_id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                          <td className="px-3 py-2">{s.room_name ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-400">{s.session_status}</td>
                          <td className="px-3 py-2">{s.tc_count}</td>
                          <td className="px-3 py-2 text-right text-cyan-300">{fmtWon(s.liquor_sales)}</td>
                          <td className="px-3 py-2 text-right text-slate-300">{fmtWon(s.waiter_tips)}</td>
                          <td className="px-3 py-2 text-right text-slate-300">{fmtWon(s.purchases)}</td>
                          <td className="px-3 py-2 text-right text-emerald-300 font-semibold">{fmtWon(s.gross_total)}</td>
                          <td className="px-3 py-2 text-right text-emerald-300">{fmtWon(s.owner_margin)}</td>
                          <td className="px-3 py-2">
                            {s.receipt_status === "finalized" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">확정</span>
                            )}
                            {s.receipt_status === "draft" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">Draft</span>
                            )}
                            {!s.receipt_status && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">미정산</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* MANAGER SETTLEMENT TAB */}
      {tab === "manager" && (
        <div className="px-4 py-4 space-y-4">
          {!managerData && <div className="text-slate-500 text-sm">로딩 중…</div>}
          {managerData && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="px-4 py-2 text-xs font-semibold text-slate-400 border-b border-white/5">
                실장별 정산 요약 ({managerData.managers.length}명)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-white/5">
                      <th className="px-3 py-2">실장</th>
                      <th className="px-3 py-2 text-right">담당 아가씨</th>
                      <th className="px-3 py-2 text-right">참여 세션</th>
                      <th className="px-3 py-2 text-right">총매출</th>
                      <th className="px-3 py-2 text-right">실장 합계</th>
                      <th className="px-3 py-2 text-right">아가씨 합계</th>
                      <th className="px-3 py-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerData.managers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-slate-500 text-xs">
                          등록된 실장이 없습니다.
                        </td>
                      </tr>
                    )}
                    {managerData.managers.map((m) => (
                      <tr key={m.manager_membership_id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-medium">{m.manager_name || "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{m.hostess_count}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{m.settlement_sessions}</td>
                        <td className="px-3 py-2 text-right text-emerald-300 font-semibold">{fmtWon(m.total_gross)}</td>
                        <td className="px-3 py-2 text-right text-purple-300">{fmtWon(m.total_manager_amount)}</td>
                        <td className="px-3 py-2 text-right text-pink-300">{fmtWon(m.total_hostess_amount)}</td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] text-emerald-300">확정 {m.finalized_count}</span>
                          {m.draft_count > 0 && (
                            <span className="text-[10px] text-cyan-300 ml-2">Draft {m.draft_count}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Force-close confirm modal (super_admin write action) */}
      {forceTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !forceSubmitting && setForceTarget(null)}
        >
          <div
            className="w-full max-w-[460px] rounded-2xl border border-red-500/30 bg-[#0d1020] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="text-red-300 text-lg">⚠</span>
              <h3 className="text-base font-bold text-red-200">세션 강제 종료</h3>
            </div>
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-200">
              이 작업은 <b>강제 종료</b>이며 감사 로그(admin_access_logs)에 기록됩니다.
              기존 체크아웃과 동일하게 참가자가 left 처리되고 채팅방이 닫힙니다.
              영업일 마감, 미확정 참가자, 가격 검증은 그대로 적용됩니다.
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] space-y-0.5">
              <div className="flex justify-between">
                <span className="text-slate-500">룸</span>
                <span>{forceTarget.room_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">세션 ID</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {forceTarget.session_id.slice(0, 8)}…
                </span>
              </div>
              {forceTarget.manager_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">실장</span>
                  <span>{forceTarget.manager_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">참가자</span>
                <span>{forceTarget.participant_count}명</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">현재 매출</span>
                <span className="text-emerald-300">{fmtWon(forceTarget.gross_total)}</span>
              </div>
            </div>

            <label className="block mt-4 text-[11px] font-semibold text-slate-300">
              사유 (필수, 최소 3자)
            </label>
            <textarea
              value={forceReason}
              onChange={(e) => setForceReason(e.target.value)}
              placeholder="예: 카운터 클라이언트 응답 없음 — 장애 복구 목적 강제 종료"
              rows={3}
              maxLength={500}
              disabled={forceSubmitting}
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:border-red-500/40 placeholder:text-slate-600 disabled:opacity-50"
              autoFocus
            />
            <div className="text-[10px] text-slate-500 mt-1 text-right">
              {forceReason.trim().length}/500
            </div>

            {forceError && (
              <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                {forceError}
              </div>
            )}
            {forceSuccess && (
              <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                {forceSuccess}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setForceTarget(null)}
                disabled={forceSubmitting}
                className="flex-1 h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={submitForceClose}
                disabled={forceSubmitting || forceReason.trim().length < 3 || !!forceSuccess}
                className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold text-white disabled:opacity-40"
              >
                {forceSubmitting ? "처리 중…" : "강제 종료 확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participant cleanup modal */}
      {cleanTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !cleanSubmitting && setCleanTarget(null)}
        >
          <div
            className="w-full max-w-[460px] rounded-2xl border border-cyan-500/30 bg-[#0d1020] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-cyan-200">참가자 전체 정리</h3>
            <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] text-cyan-100">
              {cleanTarget.room_name}의 활성 참가자를 모두 left 처리합니다.
              세션 자체는 유지됩니다. 감사 로그에 기록됩니다.
            </div>
            <div className="mt-3 text-[11px] space-y-0.5">
              <div className="flex justify-between"><span className="text-slate-500">현재 활성 참가자</span><span>{cleanTarget.participant_count}명</span></div>
            </div>
            <label className="block mt-3 text-[11px] font-semibold text-slate-300">사유 (필수, 최소 3자)</label>
            <textarea
              value={cleanReason}
              onChange={(e) => setCleanReason(e.target.value)}
              rows={3} maxLength={500} disabled={cleanSubmitting}
              placeholder="예: 클라이언트 크래시로 참가자 leave 처리 누락"
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600 disabled:opacity-50"
              autoFocus
            />
            {cleanError && <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{cleanError}</div>}
            {cleanMsg && <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">{cleanMsg}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setCleanTarget(null)} disabled={cleanSubmitting}
                className="flex-1 h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">취소</button>
              <button onClick={submitClean} disabled={cleanSubmitting || cleanReason.trim().length < 3 || !!cleanMsg}
                className="flex-1 h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-sm font-semibold text-white disabled:opacity-40">
                {cleanSubmitting ? "처리 중…" : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price override modal */}
      {priceTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !priceSubmitting && setPriceTarget(null)}
        >
          <div
            className="w-full max-w-[460px] rounded-2xl border border-purple-500/30 bg-[#0d1020] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-purple-200">주문 가격 복구</h3>
            <div className="mt-3 rounded-xl border border-purple-500/20 bg-purple-500/5 px-3 py-2 text-[11px] text-purple-100 leading-relaxed">
              {priceTarget.room_name} 세션의 <b>가격 미설정 주문 1건</b>을 정상 상태로 복구합니다.
              총 금액은 <b>정수(원)</b> 단위이며, 주문 수량에 맞춰 store_price = sale_price = floor(총액/qty)로 설정됩니다.
              실장 마진 0으로 종료 가능 상태만 확보합니다. (복수 주문 일괄 수정은 미지원)
            </div>
            <label className="block mt-3 text-[11px] font-semibold text-slate-300">총 금액 (원)</label>
            <input
              type="number" min={0} step={1} value={priceAmount} disabled={priceSubmitting}
              onChange={(e) => setPriceAmount(e.target.value)}
              placeholder="예: 150000"
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:border-purple-500/40 placeholder:text-slate-600 disabled:opacity-50"
              autoFocus
            />
            <label className="block mt-3 text-[11px] font-semibold text-slate-300">사유 (필수, 최소 3자)</label>
            <textarea
              value={priceReason} onChange={(e) => setPriceReason(e.target.value)}
              rows={3} maxLength={500} disabled={priceSubmitting}
              placeholder="예: 주문 등록 시 가격 누락 — 영수증 확인 후 복구"
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:border-purple-500/40 placeholder:text-slate-600 disabled:opacity-50"
            />
            {priceError && <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{priceError}</div>}
            {priceMsg && <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">{priceMsg}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPriceTarget(null)} disabled={priceSubmitting}
                className="flex-1 h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">취소</button>
              <button onClick={submitPriceOverride}
                disabled={priceSubmitting || priceReason.trim().length < 3 || priceAmount === "" || !!priceMsg}
                className="flex-1 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-semibold text-white disabled:opacity-40">
                {priceSubmitting ? "처리 중…" : "가격 복구"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recover (diagnostic) panel modal */}
      {recoverTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !recoverSubmitting && setRecoverTarget(null)}
        >
          <div
            className="w-full max-w-[520px] rounded-2xl border border-amber-500/30 bg-[#0d1020] p-5 my-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-amber-200">세션 상태 복구 (진단)</h3>
            <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100">
              {recoverTarget.room_name} 세션의 force-close 준비 상태를 진단합니다.
              DB 규정상 terminal state(closed/void)는 복구 불가.
              active 세션의 차단 요소를 리포트합니다.
            </div>
            {!recoverReport && (
              <>
                <label className="block mt-3 text-[11px] font-semibold text-slate-300">사유 (필수, 최소 3자)</label>
                <textarea
                  value={recoverReason} onChange={(e) => setRecoverReason(e.target.value)}
                  rows={2} maxLength={500} disabled={recoverSubmitting}
                  placeholder="예: 체크아웃 불가 원인 파악"
                  className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40 placeholder:text-slate-600 disabled:opacity-50"
                  autoFocus
                />
                {recoverError && <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{recoverError}</div>}
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setRecoverTarget(null)} disabled={recoverSubmitting}
                    className="flex-1 h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">취소</button>
                  <button onClick={submitRecover} disabled={recoverSubmitting || recoverReason.trim().length < 3}
                    className="flex-1 h-10 rounded-xl bg-amber-600 hover:bg-amber-500 text-sm font-semibold text-white disabled:opacity-40">
                    {recoverSubmitting ? "진단 중…" : "진단 실행"}
                  </button>
                </div>
              </>
            )}
            {recoverReport && (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">현재 상태</span>
                    <span className="font-semibold">{recoverReport.current_status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">force-close 준비</span>
                    <span className={recoverReport.recoverable ? "text-emerald-300 font-semibold" : "text-amber-300 font-semibold"}>
                      {recoverReport.recoverable ? "가능" : "차단됨"}
                    </span>
                  </div>
                </div>
                {recoverReport.issues.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-amber-300 mb-1">차단 요소</div>
                    <ul className="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside">
                      {recoverReport.issues.map((i, idx) => (<li key={idx}>{i}</li>))}
                    </ul>
                  </div>
                )}
                {recoverReport.next_actions.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-cyan-300 mb-1">권장 조치</div>
                    <ul className="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside">
                      {recoverReport.next_actions.map((i, idx) => (<li key={idx}>{i}</li>))}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setRecoverTarget(null); setRecoverReport(null); }}
                    className="flex-1 h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: "cyan" | "emerald" | "amber"
}) {
  const color =
    accent === "emerald" ? "text-emerald-300" :
    accent === "cyan" ? "text-cyan-300" :
    accent === "amber" ? "text-amber-300" :
    "text-white"
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-bold ${color}`}>{value}</div>
    </div>
  )
}
