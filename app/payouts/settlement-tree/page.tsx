"use client"

/**
 * 정산 트리 (settlement-tree)
 *
 * Phase 10 (2026-04-24) UX 단순화:
 *   - 상단 요약 카드 1개 (받을 돈 / 줄 돈 / 선지급 / 순 정산)
 *   - 방향 필터 탭: [전체] [받을 돈] [줄 돈]
 *   - 매장 → 실장 → 스태프 accordion 드릴다운 (페이지 이동 없음)
 *   - 색상: 초록=받을돈, 빨강=줄돈, 주황=선지급, 회색=잔액/중립
 *   - 데이터 기준 토글(근무기준/확정기준)은 우측 상단 작은 스위치로 이동
 *
 * API 변경 없음. 기존 계산/집계/선지급/배정 로직 그대로 재사용.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import ManagerPrepaymentModal from "./ManagerPrepaymentModal"
import BulkAssignModal from "./BulkAssignModal"
import { mapErrorMessage } from "./errorMessages"

// ─── Types (기존 타입 재사용) ───────────────────────────────────────────────

type StoreEntry = {
  counterpart_store_uuid: string
  counterpart_store_name: string
  outbound_total: number
  outbound_paid?: number
  outbound_remaining?: number
  inbound_total: number
  inbound_paid?: number
  inbound_remaining?: number
  net_amount: number
  outbound_count?: number
  inbound_count?: number
  outbound_prepaid?: number
}

type ManagerEntry = {
  manager_membership_id: string
  manager_name: string
  outbound_amount: number
  outbound_paid?: number
  outbound_count?: number
  inbound_amount: number
  inbound_paid?: number
  inbound_count?: number
  net_amount: number
  outbound_prepaid?: number
  outbound_remaining?: number
}

type HostessEntry = {
  participant_id: string
  session_id: string
  direction: "outbound" | "inbound"
  membership_id: string
  hostess_name: string | null
  room_name: string | null
  category: string | null
  time_minutes: number
  price_amount: number
  hostess_payout: number
  status: string
  entered_at: string
  left_at: string | null
}

type DataBasis = "operational" | "formal"
type Direction = "all" | "inbound" | "outbound"

// ─── Helpers ────────────────────────────────────────────────────────────────

const won = (v: number | null | undefined) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0
  return n.toLocaleString("ko-KR") + "원"
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettlementTreePage() {
  const router = useRouter()

  // Data basis toggle (주: 기본 operational — 실제 근무 데이터)
  const [basis, setBasis] = useState<DataBasis>("operational")
  const [direction, setDirection] = useState<Direction>("all")

  // Level 1: 매장 리스트
  const [stores, setStores] = useState<StoreEntry[]>([])
  const [loadingL1, setLoadingL1] = useState(true)
  const [error, setError] = useState("")

  // Level 2/3 accordion state — 한 번에 하나씩만 펼침 (state 단순화)
  const [expandedStore, setExpandedStore] = useState<string | null>(null)
  const [expandedManager, setExpandedManager] = useState<string | null>(null)
  // cache: fetch 결과 저장, 같은 store/manager 재펼침 시 재호출 방지
  const [managersCache, setManagersCache] = useState<Record<string, ManagerEntry[]>>({})
  const [hostessesCache, setHostessesCache] = useState<Record<string, HostessEntry[]>>({})
  const [loadingManagers, setLoadingManagers] = useState<string | null>(null)
  const [loadingHostesses, setLoadingHostesses] = useState<string | null>(null)

  // Aggregate 버튼
  const [aggLoading, setAggLoading] = useState(false)
  // R29: 인쇄 / 정산 완료 버튼
  const [printPreparing, setPrintPreparing] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmInfo, setConfirmInfo] = useState<{ confirmed_at: string; reset_at: string } | null>(null)
  // Bulk assign 모달
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  // 선지급 모달
  const [prepayTarget, setPrepayTarget] = useState<{
    counterpartStoreUuid: string
    counterpartStoreName: string
    managerMembershipId: string
    managerName: string
    managerTotal: number
    storeTotal: number
    storePrepaid: number
  } | null>(null)

  const apiBase = basis === "operational"
    ? "/api/reports/settlement-tree-operational"
    : "/api/reports/settlement-tree"

  // R29: 정산 트리 단계 — 1(오늘), 2(이틀), 3(삼일).
  //   매일 17:00 KST 에 cron 이 1→2→3→삭제 자동 진행.
  const [treeStage, setTreeStage] = useState<1 | 2 | 3>(1)

  // ─── Fetchers ─────────────────────────────────────────────────────────────

  const fetchLevel1 = useCallback(async () => {
    setLoadingL1(true)
    setError("")
    setExpandedStore(null)
    setExpandedManager(null)
    setManagersCache({})
    setHostessesCache({})
    try {
      const res = await apiFetch(`${apiBase}?stage=${treeStage}`)
      if (!res.ok) {
        setError("데이터를 불러올 수 없습니다.")
        return
      }
      const d = await res.json()
      setStores((d.stores ?? []) as StoreEntry[])
    } catch {
      setError("서버 오류")
    } finally {
      setLoadingL1(false)
    }
  }, [apiBase, treeStage])

  useEffect(() => {
    fetchLevel1()
  }, [fetchLevel1])

  async function fetchManagers(store: StoreEntry) {
    if (managersCache[store.counterpart_store_uuid]) return
    setLoadingManagers(store.counterpart_store_uuid)
    try {
      const res = await apiFetch(
        `${apiBase}?counterpart_store_uuid=${store.counterpart_store_uuid}&stage=${treeStage}`,
      )
      if (!res.ok) {
        setError("실장 정보를 불러올 수 없습니다.")
        return
      }
      const d = await res.json()
      setManagersCache((prev) => ({
        ...prev,
        [store.counterpart_store_uuid]: (d.managers ?? []) as ManagerEntry[],
      }))
    } catch {
      setError("서버 오류")
    } finally {
      setLoadingManagers(null)
    }
  }

  async function fetchHostesses(storeUuid: string, mgr: ManagerEntry) {
    const key = `${storeUuid}::${mgr.manager_membership_id}`
    if (hostessesCache[key]) return
    setLoadingHostesses(key)
    try {
      const res = await apiFetch(
        `${apiBase}?counterpart_store_uuid=${storeUuid}&manager_membership_id=${mgr.manager_membership_id}&stage=${treeStage}`,
      )
      if (!res.ok) {
        setError("스태프 정보를 불러올 수 없습니다.")
        return
      }
      const d = await res.json()
      setHostessesCache((prev) => ({
        ...prev,
        [key]: (d.hostesses ?? []) as HostessEntry[],
      }))
    } catch {
      setError("서버 오류")
    } finally {
      setLoadingHostesses(null)
    }
  }

  // R29: 인쇄용 강제 펼침 모드. true 일 때 모든 store/manager 자동 펼침.
  const [forceExpandAll, setForceExpandAll] = useState(false)

  // ─── R29: 인쇄 — 모든 매장/실장/스태프 자동 펼침 후 window.print() ─────────
  async function handlePrintAll() {
    if (printPreparing) return
    setPrintPreparing(true)
    try {
      // 1. 모든 매장의 manager + hostess 일괄 fetch
      const tasks: Promise<unknown>[] = []
      for (const s of stores) {
        if (!managersCache[s.counterpart_store_uuid]) {
          tasks.push(fetchManagers(s))
        }
      }
      await Promise.all(tasks)

      // 2. 매장별 manager 가 채워진 후 hostess 도 일괄 fetch
      const hostessTasks: Promise<unknown>[] = []
      for (const s of stores) {
        const mgrs = managersCache[s.counterpart_store_uuid] ?? []
        for (const m of mgrs) {
          const key = `${s.counterpart_store_uuid}::${m.manager_membership_id}`
          if (!hostessesCache[key]) {
            hostessTasks.push(fetchHostesses(s.counterpart_store_uuid, m))
          }
        }
      }
      await Promise.all(hostessTasks)

      // 3. forceExpandAll=true → React 가 모든 매장/실장 펼침 상태 렌더
      setForceExpandAll(true)
      document.body.classList.add("nox-print-tree-all")
      // 4. 다음 2 frame 기다림 (state → DOM 반영)
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      window.print()
      // 5. 인쇄 후 원상복구
      setTimeout(() => {
        document.body.classList.remove("nox-print-tree-all")
        setForceExpandAll(false)
      }, 1000)
    } catch (e) {
      console.error("[print] 준비 실패:", e)
    } finally {
      setPrintPreparing(false)
    }
  }

  // ─── R29: 매장 내역 삭제 (soft delete) — UI 에서만 숨김 ──────────────────
  async function handleDeleteStore(store: StoreEntry) {
    if (!confirm(
      `'${store.counterpart_store_name}' 매장의 정산 내역을 트리에서 숨깁니다.\n\n` +
      `※ 데이터 자체는 보존 (소프트 삭제). 재집계 시 다시 표시될 수 있음.\n\n` +
      `진행하시겠습니까?`,
    )) return
    try {
      const res = await apiFetch(
        `/api/payouts/settlement-tree/store?counterpart_store_uuid=${store.counterpart_store_uuid}`,
        { method: "DELETE" },
      )
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`삭제 실패: ${d.message ?? d.error ?? res.status}`)
        return
      }
      await fetchLevel1()
    } catch {
      alert("네트워크 오류")
    }
  }

  // ─── R29: 정산 완료 — 48시간 뒤 자동 리셋 ────────────────────────────────
  async function handleConfirmComplete() {
    if (confirmBusy) return
    if (!confirm("현재 정산 트리를 '완료' 처리합니다.\n48시간 뒤 자동 리셋되어 새 정산 사이클이 시작됩니다.\n\n진행하시겠습니까?")) return
    setConfirmBusy(true)
    try {
      const res = await apiFetch("/api/payouts/settlement-tree/confirm", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`정산 완료 처리 실패: ${d.message ?? d.error ?? res.status}`)
        return
      }
      setConfirmInfo({
        confirmed_at: d.confirmed_at as string,
        reset_at: d.reset_at as string,
      })
      alert(
        `✓ 정산 완료 처리됨\n` +
        `대상: ${d.settlement_count ?? 0}건 (항목 ${d.item_count ?? 0}건)\n` +
        `${new Date(d.reset_at).toLocaleString("ko-KR")} 에 자동 리셋됩니다.`,
      )
      await fetchLevel1()
    } catch {
      alert("네트워크 오류")
    } finally {
      setConfirmBusy(false)
    }
  }

  // ─── Aggregate ────────────────────────────────────────────────────────────

  async function runAggregate() {
    if (aggLoading) return
    setAggLoading(true)
    setError("")
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    try {
      const res = await apiFetch("/api/settlements/staff-work-logs/aggregate", {
        method: "POST",
        body: JSON.stringify({ from, to }),
      })
      const d = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
        created_items?: number
        skipped?: number
        unassigned_count?: number
      }
      if (!res.ok) {
        const msg = mapErrorMessage(d.error, d.message ?? `집계 실패 (${res.status})`)
        setError(msg)
        alert(msg)
        return
      }
      const created = d.created_items ?? 0
      const skipped = d.skipped ?? 0
      const unassigned = d.unassigned_count ?? 0
      alert(
        `정산 집계 완료 (생성 ${created}건, 스킵 ${skipped}건)` +
          (unassigned > 0 ? `\n미배정: ${unassigned}건` : ""),
      )
      await fetchLevel1()
    } catch {
      const msg = "네트워크 오류"
      setError(msg)
      alert(msg)
    } finally {
      setAggLoading(false)
    }
  }

  // ─── Accordion toggle ─────────────────────────────────────────────────────

  function toggleStore(s: StoreEntry) {
    if (expandedStore === s.counterpart_store_uuid) {
      setExpandedStore(null)
      setExpandedManager(null)
      return
    }
    setExpandedStore(s.counterpart_store_uuid)
    setExpandedManager(null)
    fetchManagers(s)
  }

  function toggleManager(storeUuid: string, m: ManagerEntry) {
    const key = `${storeUuid}::${m.manager_membership_id}`
    if (expandedManager === key) {
      setExpandedManager(null)
      return
    }
    setExpandedManager(key)
    fetchHostesses(storeUuid, m)
  }

  // ─── Derived: filtered/sorted stores + summary ────────────────────────────

  const filteredStores = useMemo(() => {
    let arr = stores
    if (direction === "inbound") arr = arr.filter((s) => s.inbound_total > 0)
    else if (direction === "outbound") arr = arr.filter((s) => s.outbound_total > 0)
    return [...arr].sort((a, b) => {
      if (direction === "inbound") return b.inbound_total - a.inbound_total
      if (direction === "outbound") return b.outbound_total - a.outbound_total
      return Math.abs(b.net_amount) - Math.abs(a.net_amount)
    })
  }, [stores, direction])

  const summary = useMemo(() => {
    const inbound = stores.reduce((s, x) => s + x.inbound_total, 0)
    const outbound = stores.reduce((s, x) => s + x.outbound_total, 0)
    const prepaid = stores.reduce((s, x) => s + (x.outbound_prepaid ?? 0), 0)
    const outstandingOut = Math.max(0, outbound - prepaid)
    const net = inbound - outstandingOut
    return { inbound, outbound, prepaid, outstandingOut, net }
  }, [stores])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen bg-[#0a0c14] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3 max-w-[900px] mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/counter")}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <span className="text-lg">&larr;</span>
              <span className="text-xs">뒤로</span>
            </button>
            <span className="text-base font-bold tracking-tight">정산 트리</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] nox-print-hide">
            {/* R29: 인쇄 버튼 — 모든 매장/실장/스태프 펼친 후 print */}
            <button
              onClick={handlePrintAll}
              disabled={printPreparing}
              className="px-2.5 py-1 rounded bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/[0.08] disabled:opacity-50"
              title="전체 세부내역을 펼친 후 인쇄"
            >
              {printPreparing ? "준비 중..." : "🖨 인쇄"}
            </button>
            {/* R29: 정산 완료 — 48시간 뒤 자동 리셋 */}
            <button
              onClick={handleConfirmComplete}
              disabled={confirmBusy}
              className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              title="현재 정산 트리 완료 처리. 48시간 뒤 자동 리셋."
            >
              {confirmBusy ? "..." : "✓ 정산 완료"}
            </button>
            {/* 데이터 기준 토글 */}
            <button
              onClick={() => setBasis("operational")}
              className={`px-2 py-1 rounded ${
                basis === "operational"
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title="실제 근무 데이터 기반 (기본)"
            >
              근무기준
            </button>
            <button
              onClick={() => setBasis("formal")}
              className={`px-2 py-1 rounded ${
                basis === "formal"
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title="확정된 정산 레코드 기반"
            >
              확정기준
            </button>
          </div>
        </div>
        {/* 정산 완료 표시 — 48h 카운트다운 */}
        {confirmInfo && (
          <div className="px-4 pb-2 max-w-[900px] mx-auto text-[11px] text-emerald-300 nox-print-hide">
            ✓ 정산 완료 처리됨 — {new Date(confirmInfo.reset_at).toLocaleString("ko-KR")} 에 자동 리셋
          </div>
        )}
      </div>

      <div className="max-w-[900px] mx-auto px-4 pt-4 pb-20 space-y-3">
        {/* ── R29: 정산 트리 1/2/3 단계 탭 ─────────────────────── */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 nox-print-hide">
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { stage: 1 as const, label: "정산트리 1", hint: "오늘", color: "cyan" },
              { stage: 2 as const, label: "정산트리 2", hint: "이틀 보관", color: "amber" },
              { stage: 3 as const, label: "정산트리 3", hint: "삼일 보관", color: "violet" },
            ].map(t => {
              const active = treeStage === t.stage
              const colorMap: Record<string, { bg: string; border: string; text: string }> = {
                cyan:   { bg: "bg-cyan-500/20",   border: "border-cyan-500/40",   text: "text-cyan-200" },
                amber:  { bg: "bg-amber-500/20",  border: "border-amber-500/40",  text: "text-amber-200" },
                violet: { bg: "bg-violet-500/20", border: "border-violet-500/40", text: "text-violet-200" },
              }
              const c = colorMap[t.color]!
              return (
                <button
                  key={t.stage}
                  onClick={() => setTreeStage(t.stage)}
                  className={`rounded-lg py-2 px-2 text-center transition-colors border ${
                    active
                      ? `${c.bg} ${c.border} ${c.text}`
                      : "bg-white/[0.02] border-white/10 text-slate-500 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="text-xs font-bold">{t.label}</div>
                  <div className={`text-[10px] mt-0.5 ${active ? c.text : "text-slate-600"}`}>{t.hint}</div>
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 text-center leading-relaxed">
            매일 17:00 자동 진행 — 1 → 2 (이튿날) → 3 (3일후) → 자동 삭제 (6일후). 정산 완료 즉시 삭제.
          </div>
        </div>

        {/* ── Summary card ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-4 space-y-2.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
              <div className="text-[10px] text-emerald-300/80 mb-1">받을 돈</div>
              <div className="text-lg font-bold text-emerald-300">
                {won(summary.inbound)}
              </div>
            </div>
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3">
              <div className="text-[10px] text-rose-300/80 mb-1">줄 돈</div>
              <div className="text-lg font-bold text-rose-300">
                {won(summary.outbound)}
              </div>
              {summary.prepaid > 0 && (
                <div className="text-[10px] text-amber-300/90 mt-1">
                  선지급 {won(summary.prepaid)} 차감됨
                </div>
              )}
              {summary.prepaid > 0 && (
                <div className="text-[10px] text-slate-400 mt-0.5">
                  잔액 {won(summary.outstandingOut)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-xs text-slate-400">순 정산</span>
            <span
              className={`text-xl font-bold ${
                summary.net > 0
                  ? "text-emerald-300"
                  : summary.net < 0
                    ? "text-rose-300"
                    : "text-slate-500"
              }`}
            >
              {summary.net > 0 ? "+" : ""}
              {won(summary.net)}
            </span>
          </div>
        </div>

        {/* ── 운영 순서 + 버튼 ─────────────────────────────────── */}
        <div className="rounded-xl bg-slate-800/40 border border-white/5 p-2.5 flex items-center gap-2">
          <div className="flex-1 text-[11px] text-slate-400">
            <span className="text-slate-300 font-semibold">1.</span> 집계{" "}
            <span className="text-slate-600">→</span>{" "}
            <span className="text-slate-300 font-semibold">2.</span> 실장 배정{" "}
            <span className="text-slate-600">→</span>{" "}
            <span className="text-slate-300 font-semibold">3.</span> 지급
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggLoading}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-[11px] font-semibold hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {aggLoading ? "집계 중..." : "정산 집계"}
          </button>
          <button
            type="button"
            onClick={() => setBulkAssignOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-200 text-[11px] font-semibold hover:bg-purple-500/25"
          >
            실장 배정
          </button>
        </div>

        {/* ── Direction 탭 ─────────────────────────────────────── */}
        <div className="flex gap-1">
          <DirectionTab
            active={direction === "all"}
            onClick={() => setDirection("all")}
            label="전체"
            count={stores.length}
          />
          <DirectionTab
            active={direction === "inbound"}
            onClick={() => setDirection("inbound")}
            label="받을 돈"
            color="emerald"
            count={stores.filter((s) => s.inbound_total > 0).length}
          />
          <DirectionTab
            active={direction === "outbound"}
            onClick={() => setDirection("outbound")}
            label="줄 돈"
            color="rose"
            count={stores.filter((s) => s.outbound_total > 0).length}
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* ── 매장 리스트 (accordion) ─────────────────────────── */}
        {loadingL1 ? (
          <div className="py-12 text-center text-slate-500 text-sm animate-pulse">
            불러오는 중...
          </div>
        ) : filteredStores.length === 0 ? (
          <EmptyState direction={direction} basis={basis} onGo={() => router.push("/payouts")} />
        ) : (
          <div className="space-y-2">
            {filteredStores.map((s) => (
              <StoreCard
                key={s.counterpart_store_uuid}
                store={s}
                direction={direction}
                expanded={forceExpandAll || expandedStore === s.counterpart_store_uuid}
                onToggle={() => toggleStore(s)}
                onDelete={() => handleDeleteStore(s)}
                managers={managersCache[s.counterpart_store_uuid] ?? null}
                loadingManagers={loadingManagers === s.counterpart_store_uuid}
                expandedManager={forceExpandAll ? "__all__" : expandedManager}
                forceExpandAllManagers={forceExpandAll}
                onToggleManager={(m) => toggleManager(s.counterpart_store_uuid, m)}
                hostessesCache={hostessesCache}
                loadingHostesses={loadingHostesses}
                basis={basis}
                onPrepay={(m) => {
                  setPrepayTarget({
                    counterpartStoreUuid: s.counterpart_store_uuid,
                    counterpartStoreName: s.counterpart_store_name,
                    managerMembershipId: m.manager_membership_id,
                    managerName: m.manager_name,
                    managerTotal: m.outbound_amount,
                    storeTotal: s.outbound_total,
                    storePrepaid: s.outbound_prepaid ?? 0,
                  })
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 선지급 모달 */}
      {prepayTarget && (
        <ManagerPrepaymentModal
          open={!!prepayTarget}
          counterpartStoreUuid={prepayTarget.counterpartStoreUuid}
          counterpartStoreName={prepayTarget.counterpartStoreName}
          managerMembershipId={prepayTarget.managerMembershipId}
          managerName={prepayTarget.managerName}
          managerTotal={prepayTarget.managerTotal}
          storeTotal={prepayTarget.storeTotal}
          storePrepaid={prepayTarget.storePrepaid}
          onClose={() => setPrepayTarget(null)}
          onSaved={async () => {
            // 재조회: L1 + 현재 펼쳐진 store 의 managers 캐시 invalidate
            await fetchLevel1()
            if (expandedStore) {
              setManagersCache((prev) => {
                const next = { ...prev }
                delete next[expandedStore]
                return next
              })
              const refetchStore = stores.find(
                (x) => x.counterpart_store_uuid === expandedStore,
              )
              if (refetchStore) await fetchManagers(refetchStore)
            }
          }}
        />
      )}

      {/* Bulk assign */}
      <BulkAssignModal
        open={bulkAssignOpen}
        onClose={() => setBulkAssignOpen(false)}
        counterpartStoreUuid={expandedStore ?? undefined}
        onDone={async () => {
          await fetchLevel1()
          if (expandedStore) {
            setManagersCache((prev) => {
              const next = { ...prev }
              delete next[expandedStore]
              return next
            })
            const refetchStore = stores.find(
              (x) => x.counterpart_store_uuid === expandedStore,
            )
            if (refetchStore) await fetchManagers(refetchStore)
          }
        }}
      />
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DirectionTab({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  color?: "emerald" | "rose"
}) {
  const activeCls =
    color === "emerald"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : color === "rose"
        ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
        : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
        active
          ? activeCls
          : "bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06]"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
      )}
    </button>
  )
}

function EmptyState({
  direction,
  basis,
  onGo,
}: {
  direction: Direction
  basis: DataBasis
  onGo: () => void
}) {
  const msg =
    direction === "inbound"
      ? "받을 돈이 없습니다."
      : direction === "outbound"
        ? "줄 돈이 없습니다."
        : basis === "operational"
          ? "타매장 근무 내역이 없습니다."
          : "확정된 교차정산이 없습니다."
  return (
    <div className="py-16 flex flex-col items-center gap-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 max-w-[360px] w-full text-center">
        <div className="text-slate-400 text-sm">{msg}</div>
      </div>
      <button
        onClick={onGo}
        className="px-5 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 text-xs font-semibold border border-cyan-500/25 hover:bg-cyan-500/25"
      >
        ← 정산 현황
      </button>
    </div>
  )
}

function StoreCard({
  store,
  direction,
  expanded,
  onToggle,
  onDelete,
  managers,
  loadingManagers,
  expandedManager,
  forceExpandAllManagers,
  onToggleManager,
  hostessesCache,
  loadingHostesses,
  basis,
  onPrepay,
}: {
  store: StoreEntry
  direction: Direction
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  managers: ManagerEntry[] | null
  loadingManagers: boolean
  expandedManager: string | null
  forceExpandAllManagers?: boolean
  onToggleManager: (m: ManagerEntry) => void
  hostessesCache: Record<string, HostessEntry[]>
  loadingHostesses: string | null
  basis: DataBasis
  onPrepay: (m: ManagerEntry) => void
}) {
  const prepaid = store.outbound_prepaid ?? 0
  const outstandingOut = Math.max(0, store.outbound_total - prepaid)
  const isOperational = basis === "operational"

  // 펼친 상태에서 매장별 accent 색 (direction 에 따라 좌측 테두리 강조)
  const accentClass = expanded
    ? direction === "inbound" || (direction === "all" && store.net_amount > 0)
      ? "border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.04]"
      : direction === "outbound" || (direction === "all" && store.net_amount < 0)
        ? "border-l-4 border-l-rose-500/60 bg-rose-500/[0.04]"
        : "border-l-4 border-l-slate-500/40 bg-white/[0.04]"
    : "bg-white/[0.03]"

  return (
    <div
      data-print-store
      className={`rounded-xl border border-white/10 overflow-hidden transition-colors ${accentClass}`}
    >
      {/* 헤더 행: 본체(토글) + 우측 내역삭제 버튼 — 두 버튼 분리 (HTML 중첩 회피) */}
      <div className="flex items-stretch">
        <button
          onClick={onToggle}
          className="flex-1 text-left p-3.5 hover:bg-white/[0.05] transition-colors min-w-0"
        >
          <div className="flex items-center gap-3">
            <span className="text-slate-500 text-[10px] w-3 nox-print-hide">
              {expanded ? "▼" : "▶"}
            </span>
            <span className="flex-1 text-sm font-bold truncate">
              {store.counterpart_store_name}
            </span>
            <StorePrimaryBadge
              direction={direction}
              store={store}
              outstandingOut={outstandingOut}
            />
          </div>
          <StoreSubline
            direction={direction}
            store={store}
            prepaid={prepaid}
            outstandingOut={outstandingOut}
            isOperational={isOperational}
          />
        </button>
        {/* R29: 매장 단위 내역삭제 (soft delete) */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="이 매장 정산 내역을 트리에서 숨김 (soft delete)"
          className="nox-print-hide px-3 text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors text-[10px] border-l border-white/[0.04]"
        >
          내역삭제
        </button>
      </div>

      {/* 실장 리스트 (펼침) — 배경을 살짝 밝게 + 좌측 여백으로 계층 명확
          R29: data-accordion="store" 로 print mode 에서 강제 표시 */}
      {expanded && (
        <div data-accordion="store" className="bg-[#0f131c] border-t border-white/10 pl-4 pr-2 py-3 space-y-2">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider pl-1">
            실장별 내역
          </div>
          {loadingManagers && !managers ? (
            <div className="py-4 text-center text-slate-500 text-xs animate-pulse">
              불러오는 중...
            </div>
          ) : !managers || managers.length === 0 ? (
            <div className="py-4 text-center text-slate-500 text-xs">
              실장별 내역이 없습니다.
            </div>
          ) : (
            managers.map((m) => (
              <ManagerRow
                key={m.manager_membership_id}
                storeUuid={store.counterpart_store_uuid}
                mgr={m}
                direction={direction}
                expanded={
                  forceExpandAllManagers || expandedManager ===
                  `${store.counterpart_store_uuid}::${m.manager_membership_id}`
                }
                onToggle={() => onToggleManager(m)}
                hostesses={
                  hostessesCache[
                    `${store.counterpart_store_uuid}::${m.manager_membership_id}`
                  ] ?? null
                }
                loadingHostesses={
                  loadingHostesses ===
                  `${store.counterpart_store_uuid}::${m.manager_membership_id}`
                }
                isOperational={isOperational}
                onPrepay={() => onPrepay(m)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StorePrimaryBadge({
  direction,
  store,
  outstandingOut,
}: {
  direction: Direction
  store: StoreEntry
  outstandingOut: number
}) {
  if (direction === "inbound") {
    return store.inbound_total > 0 ? (
      <span className="text-base font-bold text-emerald-300">
        +{won(store.inbound_total)}
      </span>
    ) : (
      <span className="text-slate-500 text-xs">±0</span>
    )
  }
  if (direction === "outbound") {
    return outstandingOut > 0 ? (
      <span className="text-base font-bold text-rose-300">
        -{won(outstandingOut)}
      </span>
    ) : store.outbound_total > 0 ? (
      <span className="text-base font-bold text-slate-400">완납</span>
    ) : (
      <span className="text-slate-500 text-xs">±0</span>
    )
  }
  // all: net 표시
  if (store.net_amount === 0) return <span className="text-slate-500 text-xs">±0</span>
  const positive = store.net_amount > 0
  return (
    <span className={`text-base font-bold ${positive ? "text-emerald-300" : "text-rose-300"}`}>
      {positive ? "+" : ""}
      {won(store.net_amount)}
    </span>
  )
}

function StoreSubline({
  direction,
  store,
  prepaid,
  outstandingOut,
  isOperational,
}: {
  direction: Direction
  store: StoreEntry
  prepaid: number
  outstandingOut: number
  isOperational: boolean
}) {
  if (direction === "inbound") {
    if (store.inbound_total <= 0) return null
    return (
      <div className="mt-1.5 ml-5 text-[10px] text-slate-500 flex gap-3">
        {(store.inbound_count ?? 0) > 0 && <span>{store.inbound_count}건</span>}
        {(store.inbound_paid ?? 0) > 0 && (
          <span>수금완료 <span className="text-slate-300">{won(store.inbound_paid)}</span></span>
        )}
      </div>
    )
  }
  if (direction === "outbound") {
    if (store.outbound_total <= 0) return null
    return (
      <div className="mt-1.5 ml-5 text-[10px] text-slate-500 flex gap-3 flex-wrap">
        <span>총 줄 돈 <span className="text-rose-300/80">{won(store.outbound_total)}</span></span>
        {isOperational && prepaid > 0 && (
          <span>선지급 <span className="text-amber-300">{won(prepaid)}</span></span>
        )}
        {isOperational && prepaid > 0 && (
          <span>잔액 <span className="text-slate-300">{won(outstandingOut)}</span></span>
        )}
      </div>
    )
  }
  // all
  return (
    <div className="mt-1.5 ml-5 text-[10px] text-slate-500 flex gap-3 flex-wrap">
      {store.inbound_total > 0 && (
        <span>받을 <span className="text-emerald-300">{won(store.inbound_total)}</span></span>
      )}
      {store.outbound_total > 0 && (
        <span>줄 <span className="text-rose-300">{won(store.outbound_total)}</span></span>
      )}
      {isOperational && prepaid > 0 && (
        <span>선지급 <span className="text-amber-300">{won(prepaid)}</span></span>
      )}
    </div>
  )
}

function ManagerRow({
  mgr,
  direction,
  expanded,
  onToggle,
  hostesses,
  loadingHostesses,
  isOperational,
  onPrepay,
}: {
  storeUuid: string
  mgr: ManagerEntry
  direction: Direction
  expanded: boolean
  onToggle: () => void
  hostesses: HostessEntry[] | null
  loadingHostesses: boolean
  isOperational: boolean
  onPrepay: () => void
}) {
  const prepaid = mgr.outbound_prepaid ?? 0
  const remaining = mgr.outbound_remaining ?? Math.max(0, mgr.outbound_amount - prepaid)
  const unassigned = mgr.manager_membership_id === "__unassigned__"
  const canPrepay = isOperational && !unassigned && mgr.outbound_amount > 0 && remaining > 0

  // direction 에 맞게 숨길 row
  if (direction === "inbound" && mgr.inbound_amount <= 0) return null
  if (direction === "outbound" && mgr.outbound_amount <= 0) return null

  const mgrAccent = expanded
    ? direction === "inbound" || (direction === "all" && mgr.net_amount > 0)
      ? "border-l-2 border-l-emerald-500/50 bg-emerald-500/[0.05]"
      : direction === "outbound" || (direction === "all" && mgr.net_amount < 0)
        ? "border-l-2 border-l-rose-500/50 bg-rose-500/[0.05]"
        : "bg-white/[0.04]"
    : "bg-white/[0.025] border-l-2 border-l-transparent"

  return (
    <div className={`rounded-lg border border-white/10 overflow-hidden ${mgrAccent}`}>
      <div className="flex items-stretch">
        <button
          onClick={onToggle}
          className="flex-1 text-left p-2.5 hover:bg-white/[0.04] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-slate-600 text-[10px] w-3">
              {expanded ? "▼" : "▶"}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">
              실장
            </span>
            <span className="text-xs font-medium">
              {unassigned ? "미배정" : mgr.manager_name}
            </span>
            {unassigned && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-semibold">
                배정 필요
              </span>
            )}
            <span className="flex-1" />
            <ManagerPrimaryBadge direction={direction} mgr={mgr} remaining={remaining} />
          </div>
          <div className="mt-1 ml-5 flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
            {direction !== "inbound" && mgr.outbound_amount > 0 && (
              <span>
                줄 <span className="text-rose-300/90">{won(mgr.outbound_amount)}</span>
              </span>
            )}
            {direction !== "outbound" && mgr.inbound_amount > 0 && (
              <span>
                받을 <span className="text-emerald-300/90">{won(mgr.inbound_amount)}</span>
              </span>
            )}
            {isOperational && prepaid > 0 && direction !== "inbound" && (
              <span>
                선지급 <span className="text-amber-300">{won(prepaid)}</span>
              </span>
            )}
            {isOperational && prepaid > 0 && direction !== "inbound" && (
              <span>
                잔액 <span className="text-slate-300">{won(remaining)}</span>
              </span>
            )}
          </div>
        </button>
        {canPrepay && (direction === "outbound" || direction === "all") && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrepay()
            }}
            className="px-3 text-[11px] font-semibold text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border-l border-white/5"
            title="선지급 실행"
          >
            선지급
          </button>
        )}
      </div>

      {/* 스태프 리스트 (펼침) — 테이블 배경 대비 강화 */}
      {expanded && (
        <div className="border-t border-white/10 bg-[#060a12] px-3 py-3">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">
            스태프별 상세
          </div>
          {loadingHostesses && !hostesses ? (
            <div className="py-3 text-center text-slate-500 text-[11px] animate-pulse">
              불러오는 중...
            </div>
          ) : !hostesses || hostesses.length === 0 ? (
            <div className="py-3 text-center text-slate-500 text-[11px]">
              스태프별 내역이 없습니다.
            </div>
          ) : (
            <HostessTable hostesses={hostesses} direction={direction} />
          )}
        </div>
      )}
    </div>
  )
}

function ManagerPrimaryBadge({
  direction,
  mgr,
  remaining,
}: {
  direction: Direction
  mgr: ManagerEntry
  remaining: number
}) {
  if (direction === "inbound") {
    return mgr.inbound_amount > 0 ? (
      <span className="text-sm font-bold text-emerald-300">+{won(mgr.inbound_amount)}</span>
    ) : null
  }
  if (direction === "outbound") {
    return remaining > 0 ? (
      <span className="text-sm font-bold text-rose-300">-{won(remaining)}</span>
    ) : mgr.outbound_amount > 0 ? (
      <span className="text-xs font-bold text-slate-400">완납</span>
    ) : null
  }
  // all: net
  if (mgr.net_amount === 0) return <span className="text-slate-500 text-xs">±0</span>
  const positive = mgr.net_amount > 0
  return (
    <span className={`text-sm font-bold ${positive ? "text-emerald-300" : "text-rose-300"}`}>
      {positive ? "+" : ""}
      {won(mgr.net_amount)}
    </span>
  )
}

function HostessTable({
  hostesses,
  direction,
}: {
  hostesses: HostessEntry[]
  direction: Direction
}) {
  // direction 에 맞춰 필터
  const rows = hostesses.filter((h) => {
    if (direction === "inbound") return h.direction === "inbound"
    if (direction === "outbound") return h.direction === "outbound"
    return true
  })
  if (rows.length === 0) {
    return (
      <div className="py-2 text-center text-slate-600 text-[10px]">
        해당 방향 내역 없음
      </div>
    )
  }
  const outTotal = rows
    .filter((h) => h.direction === "outbound")
    .reduce((s, h) => s + h.hostess_payout, 0)
  const inTotal = rows
    .filter((h) => h.direction === "inbound")
    .reduce((s, h) => s + h.hostess_payout, 0)
  return (
    <div className="rounded-lg overflow-hidden border border-white/10 bg-white/[0.025]">
      <div className="grid grid-cols-[40px_1fr_50px_50px_80px_80px_50px] gap-0 bg-white/[0.05] px-2 py-1.5 text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
        <div>방향</div>
        <div>스태프</div>
        <div>룸</div>
        <div>종목</div>
        <div className="text-right">단가</div>
        <div className="text-right">지급액</div>
        <div className="text-right">퇴장</div>
      </div>
      {rows.map((h) => (
        <div
          key={h.participant_id}
          className="grid grid-cols-[40px_1fr_50px_50px_80px_80px_50px] gap-0 px-2 py-1.5 border-t border-white/[0.05] text-[10px] hover:bg-white/[0.02]"
        >
          <div>
            {h.direction === "outbound" ? (
              <span className="text-[8px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-300">
                줄
              </span>
            ) : (
              <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                받을
              </span>
            )}
          </div>
          <div className="text-slate-100 truncate">{h.hostess_name || "-"}</div>
          <div className="text-slate-500 truncate">{h.room_name || "-"}</div>
          <div className="text-slate-500">{h.category || "-"}</div>
          <div className="text-right text-slate-400">{won(h.price_amount)}</div>
          <div
            className={`text-right font-semibold ${
              h.direction === "outbound" ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {won(h.hostess_payout)}
          </div>
          <div className="text-right text-slate-600">{fmtTime(h.left_at)}</div>
        </div>
      ))}
      <div className="px-2 py-1.5 bg-white/[0.05] border-t border-white/10 flex items-center justify-between text-[10px]">
        <span className="text-slate-400 font-semibold">{rows.length}건</span>
        <div className="flex items-center gap-3 font-semibold">
          {outTotal > 0 && <span className="text-rose-300">줄 {won(outTotal)}</span>}
          {inTotal > 0 && <span className="text-emerald-300">받을 {won(inTotal)}</span>}
        </div>
      </div>
    </div>
  )
}
