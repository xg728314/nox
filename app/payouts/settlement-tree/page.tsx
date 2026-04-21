"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import ManagerPrepaymentModal from "./ManagerPrepaymentModal"

// ─── Types ──────────────────────────────────────────────────────────────────

type StoreEntry = {
  counterpart_store_uuid: string
  counterpart_store_name: string
  // formal tab fields
  outbound_total: number
  outbound_paid?: number
  outbound_remaining?: number
  inbound_total: number
  inbound_paid?: number
  inbound_remaining?: number
  net_amount: number
  // operational tab fields
  outbound_count?: number
  inbound_count?: number
  // STEP-043 prepayment ledger fields (operational tab only)
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
  // STEP-043 prepayment ledger fields (operational tab only)
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

type Tab = "operational" | "formal"

// ─── Helpers ────────────────────────────────────────────────────────────────

const won = (v: number) => v.toLocaleString("ko-KR") + "원"

function NetBadge({ amount }: { amount: number }) {
  if (amount === 0) return <span className="text-slate-500 text-xs">±0</span>
  const positive = amount > 0
  return (
    <span className={`text-sm font-bold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
      {positive ? "+" : ""}{won(amount)}
    </span>
  )
}

function DirectionTag({ d }: { d: "outbound" | "inbound" }) {
  return d === "outbound"
    ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">지급</span>
    : <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">수금</span>
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettlementTreePage() {
  const router = useRouter()

  // Tab
  const [tab, setTab] = useState<Tab>("operational")

  // Level 1
  const [stores, setStores] = useState<StoreEntry[]>([])
  const [loadingL1, setLoadingL1] = useState(true)

  // Level 2
  const [selectedStore, setSelectedStore] = useState<StoreEntry | null>(null)
  const [managers, setManagers] = useState<ManagerEntry[]>([])
  const [loadingL2, setLoadingL2] = useState(false)
  const [counterpartName, setCounterpartName] = useState("")

  // Level 3
  const [selectedManager, setSelectedManager] = useState<ManagerEntry | null>(null)
  const [hostesses, setHostesses] = useState<HostessEntry[]>([])
  const [loadingL3, setLoadingL3] = useState(false)
  const [managerName, setManagerName] = useState("")

  const [error, setError] = useState("")

  // STEP-043: prepayment modal state — opens from a Level 2 row.
  const [prepayTarget, setPrepayTarget] = useState<{
    counterpartStoreUuid: string
    counterpartStoreName: string
    managerMembershipId: string
    managerName: string
    managerTotal: number
    storeTotal: number
    storePrepaid: number
  } | null>(null)

  // ─── API base path per tab ────────────────────────────────────────────────

  function apiBase(): string {
    return tab === "operational"
      ? "/api/reports/settlement-tree-operational"
      : "/api/reports/settlement-tree"
  }

  // ─── Fetchers ─────────────────────────────────────────────────────────────

  async function fetchLevel1() {
    setLoadingL1(true)
    setError("")
    setSelectedStore(null)
    setSelectedManager(null)
    setManagers([])
    setHostesses([])
    try {
      const res = await apiFetch(apiBase())
      if (!res.ok) { setError("데이터를 불러올 수 없습니다."); return }
      const d = await res.json()
      setStores(d.stores ?? [])
    } catch { setError("서버 오류") }
    finally { setLoadingL1(false) }
  }

  async function fetchLevel2(store: StoreEntry) {
    setSelectedStore(store)
    setSelectedManager(null)
    setHostesses([])
    setLoadingL2(true)
    setError("")
    try {
      const res = await apiFetch(`${apiBase()}?counterpart_store_uuid=${store.counterpart_store_uuid}`)
      if (!res.ok) { setError("실장 정보를 불러올 수 없습니다."); return }
      const d = await res.json()
      setManagers(d.managers ?? [])
      setCounterpartName(d.counterpart_store_name ?? store.counterpart_store_name)
    } catch { setError("서버 오류") }
    finally { setLoadingL2(false) }
  }

  async function fetchLevel3(mgr: ManagerEntry) {
    if (!selectedStore) return
    setSelectedManager(mgr)
    setLoadingL3(true)
    setError("")
    try {
      const res = await apiFetch(
        `${apiBase()}?counterpart_store_uuid=${selectedStore.counterpart_store_uuid}&manager_membership_id=${mgr.manager_membership_id}`
      )
      if (!res.ok) { setError("아가씨 정보를 불러올 수 없습니다."); return }
      const d = await res.json()
      setHostesses(d.hostesses ?? [])
      setManagerName(d.manager_name ?? mgr.manager_name)
    } catch { setError("서버 오류") }
    finally { setLoadingL3(false) }
  }

  useEffect(() => {
    fetchLevel1()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fetch Level 1 on tab change
  function switchTab(t: Tab) {
    setTab(t)
    // Schedule fetch after state update
    setTimeout(() => {
      /* empty — useEffect below handles it */
    }, 0)
  }

  useEffect(() => {
    fetchLevel1()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ─── Breadcrumb ───────────────────────────────────────────────────────────

  function handleBackToL1() {
    setSelectedStore(null)
    setSelectedManager(null)
    setManagers([])
    setHostesses([])
  }

  function handleBackToL2() {
    setSelectedManager(null)
    setHostesses([])
  }

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
              onClick={() => router.push("/payouts")}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <span className="text-lg">&larr;</span>
              <span className="text-xs">정산 현황</span>
            </button>
            <span className="text-base font-bold tracking-tight">정산 트리</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[900px] mx-auto px-4 pb-2 flex gap-1">
          <button
            onClick={() => switchTab("operational")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === "operational"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "bg-white/5 text-slate-400 border border-white/[0.06] hover:bg-white/10"
            }`}
          >실제 근무 내역</button>
          <button
            onClick={() => switchTab("formal")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === "formal"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "bg-white/5 text-slate-400 border border-white/[0.06] hover:bg-white/10"
            }`}
          >정산 내역</button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-[900px] mx-auto px-4 pt-3 pb-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            onClick={handleBackToL1}
            className={`${!selectedStore ? "text-cyan-300 font-semibold" : "text-slate-400 hover:text-white"}`}
          >매장별</button>
          {selectedStore && (
            <>
              <span className="text-slate-600">/</span>
              <button
                onClick={handleBackToL2}
                className={`${!selectedManager ? "text-cyan-300 font-semibold" : "text-slate-400 hover:text-white"}`}
              >{counterpartName}</button>
            </>
          )}
          {selectedManager && (
            <>
              <span className="text-slate-600">/</span>
              <span className="text-cyan-300 font-semibold">{managerName}</span>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="max-w-[900px] mx-auto px-4 mt-2">
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
        </div>
      )}

      <div className="max-w-[900px] mx-auto px-4 py-3 pb-20">

        {/* ════ LEVEL 1: Store-to-store ════════════════════════════════════ */}
        {!selectedStore && (
          <>
            {loadingL1 ? (
              <div className="py-12 text-center text-slate-500 text-sm animate-pulse">불러오는 중...</div>
            ) : stores.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 max-w-[360px] w-full text-center">
                  <div className="text-slate-400 text-sm mb-1">
                    {tab === "operational"
                      ? "현재 타매장 근무 내역이 없습니다"
                      : "현재 교차정산 데이터가 없습니다"}
                  </div>
                  <div className="text-slate-600 text-[11px]">
                    {tab === "operational"
                      ? "아가씨가 타매장에서 근무하면 여기에 자동으로 표시됩니다."
                      : "정산 현황으로 돌아가 교차정산을 먼저 등록하세요."}
                  </div>
                </div>
                <button
                  onClick={() => router.push("/payouts")}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 text-xs font-semibold border border-cyan-500/25 hover:bg-cyan-500/25 transition-colors"
                >← 정산 현황으로 이동</button>
              </div>
            ) : (
              <div className="space-y-2">
                {stores.map(s => (
                  <button
                    key={s.counterpart_store_uuid}
                    onClick={() => fetchLevel2(s)}
                    className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold">{s.counterpart_store_name}</span>
                      <NetBadge amount={s.net_amount} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div className="rounded-lg bg-rose-500/5 border border-rose-500/10 p-2.5">
                        <div className="text-[9px] text-rose-300/70 mb-0.5">지급 (우리→상대)</div>
                        <div className="text-rose-300 font-semibold">{won(s.outbound_total)}</div>
                        {(s.outbound_count ?? 0) > 0 && (
                          <div className="text-[9px] text-slate-500 mt-0.5">{s.outbound_count}건</div>
                        )}
                        {(s.outbound_paid ?? 0) > 0 && (
                          <div className="text-[9px] text-slate-500 mt-0.5">지급완료 {won(s.outbound_paid!)}</div>
                        )}
                        {/* STEP-043: operational tab prepayment summary */}
                        {tab === "operational" && (s.outbound_prepaid ?? 0) > 0 && (
                          <>
                            <div className="text-[9px] text-amber-300/80 mt-0.5">선지급 {won(s.outbound_prepaid ?? 0)}</div>
                            <div className="text-[9px] text-emerald-300/80 mt-0.5">
                              잔액 {won(Math.max(0, s.outbound_total - (s.outbound_prepaid ?? 0)))}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-2.5">
                        <div className="text-[9px] text-emerald-300/70 mb-0.5">수금 (상대→우리)</div>
                        <div className="text-emerald-300 font-semibold">{won(s.inbound_total)}</div>
                        {(s.inbound_count ?? 0) > 0 && (
                          <div className="text-[9px] text-slate-500 mt-0.5">{s.inbound_count}건</div>
                        )}
                        {(s.inbound_paid ?? 0) > 0 && (
                          <div className="text-[9px] text-slate-500 mt-0.5">수금완료 {won(s.inbound_paid!)}</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ════ LEVEL 2: Manager breakdown ═════════════════════════════════ */}
        {selectedStore && !selectedManager && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{counterpartName}</span>
                <NetBadge amount={selectedStore.net_amount} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                <div className="text-slate-400">지급 <span className="text-rose-300">{won(selectedStore.outbound_total)}</span></div>
                <div className="text-slate-400">수금 <span className="text-emerald-300">{won(selectedStore.inbound_total)}</span></div>
              </div>
              {tab === "operational" && (selectedStore.outbound_prepaid ?? 0) > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
                  <div className="text-slate-400">선지급 <span className="text-amber-300">{won(selectedStore.outbound_prepaid ?? 0)}</span></div>
                  <div className="text-slate-400">잔액 <span className="text-emerald-300">{won(Math.max(0, selectedStore.outbound_total - (selectedStore.outbound_prepaid ?? 0)))}</span></div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-500 font-semibold mb-2 px-1">실장별 내역</div>

            {loadingL2 ? (
              <div className="py-8 text-center text-slate-500 text-sm animate-pulse">불러오는 중...</div>
            ) : managers.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-sm">실장별 내역이 없습니다.</div>
            ) : (
              <div className="space-y-1.5">
                {managers.map(m => {
                  // STEP-043: operational tab exposes outbound_prepaid/remaining.
                  const isOperational = tab === "operational"
                  const prepaid = m.outbound_prepaid ?? 0
                  const remaining = m.outbound_remaining ?? Math.max(0, m.outbound_amount - prepaid)
                  const unassigned = m.manager_membership_id === "__unassigned__"
                  const canPrepay =
                    isOperational &&
                    !unassigned &&
                    !!selectedStore &&
                    m.outbound_amount > 0 &&
                    remaining > 0
                  return (
                    <div
                      key={m.manager_membership_id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                    >
                      <button
                        onClick={() => fetchLevel3(m)}
                        className="w-full text-left p-3.5"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">실장</span>
                            <span className="text-sm font-medium">{m.manager_name}</span>
                          </div>
                          <NetBadge amount={m.net_amount} />
                        </div>
                        <div className="flex items-center gap-4 text-[10px] flex-wrap">
                          {m.outbound_amount > 0 && (
                            <span className="text-slate-400">지급 <span className="text-rose-300">{won(m.outbound_amount)}</span></span>
                          )}
                          {m.inbound_amount > 0 && (
                            <span className="text-slate-400">수금 <span className="text-emerald-300">{won(m.inbound_amount)}</span></span>
                          )}
                          {isOperational && prepaid > 0 && (
                            <span className="text-slate-400">선지급 <span className="text-amber-300">{won(prepaid)}</span></span>
                          )}
                          {isOperational && m.outbound_amount > 0 && (
                            <span className="text-slate-400">잔액 <span className="text-emerald-300">{won(remaining)}</span></span>
                          )}
                        </div>
                      </button>
                      {canPrepay && selectedStore && (
                        <div className="px-3 pb-3 -mt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPrepayTarget({
                                counterpartStoreUuid: selectedStore.counterpart_store_uuid,
                                counterpartStoreName: selectedStore.counterpart_store_name,
                                managerMembershipId: m.manager_membership_id,
                                managerName: m.manager_name,
                                managerTotal: m.outbound_amount,
                                storeTotal: selectedStore.outbound_total,
                                storePrepaid: selectedStore.outbound_prepaid ?? 0,
                              })
                            }}
                            className="w-full py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-semibold hover:bg-amber-500/25 active:scale-95 transition-all"
                          >
                            선지급
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ════ LEVEL 3: Hostess trace ═════════════════════════════════════ */}
        {selectedStore && selectedManager && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">실장</span>
                  <span className="text-sm font-bold">{managerName}</span>
                </div>
                <NetBadge amount={selectedManager.net_amount} />
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{counterpartName} 관련 아가씨 내역</div>
            </div>

            <div className="text-[10px] text-slate-500 font-semibold mb-2 px-1">아가씨별 상세</div>

            {loadingL3 ? (
              <div className="py-8 text-center text-slate-500 text-sm animate-pulse">불러오는 중...</div>
            ) : hostesses.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-sm">해당 실장의 타매장 아가씨 내역이 없습니다.</div>
            ) : (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_80px_50px_80px_80px_50px] gap-0 bg-white/[0.04] border-b border-white/10 px-3 py-2 text-[9px] text-slate-500 font-semibold">
                  <div className="w-10">구분</div>
                  <div>아가씨</div>
                  <div>룸</div>
                  <div>종목</div>
                  <div className="text-right">단가</div>
                  <div className="text-right">지급액</div>
                  <div className="text-right">퇴장</div>
                </div>
                {hostesses.map(h => (
                  <div
                    key={h.participant_id}
                    className="grid grid-cols-[auto_1fr_80px_50px_80px_80px_50px] gap-0 px-3 py-2 border-b border-white/[0.05] text-[11px] hover:bg-white/[0.03]"
                  >
                    <div className="w-10"><DirectionTag d={h.direction} /></div>
                    <div className="text-white font-medium truncate">{h.hostess_name || "-"}</div>
                    <div className="text-slate-400 truncate">{h.room_name || "-"}</div>
                    <div className="text-slate-400">{h.category || "-"}</div>
                    <div className="text-right text-slate-300">{won(h.price_amount)}</div>
                    <div className={`text-right font-semibold ${h.direction === "outbound" ? "text-rose-300" : "text-emerald-300"}`}>
                      {won(h.hostess_payout)}
                    </div>
                    <div className="text-right text-slate-500">{fmtTime(h.left_at)}</div>
                  </div>
                ))}
                <div className="px-3 py-2.5 bg-white/[0.04] border-t border-white/10">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">{hostesses.length}건</span>
                    <div className="flex items-center gap-4">
                      {(() => {
                        const outTotal = hostesses.filter(h => h.direction === "outbound").reduce((s, h) => s + h.hostess_payout, 0)
                        const inTotal = hostesses.filter(h => h.direction === "inbound").reduce((s, h) => s + h.hostess_payout, 0)
                        return (
                          <>
                            {outTotal > 0 && <span className="text-rose-300">지급 {won(outTotal)}</span>}
                            {inTotal > 0 && <span className="text-emerald-300">수금 {won(inTotal)}</span>}
                            <span className="font-bold"><NetBadge amount={inTotal - outTotal} /></span>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* STEP-043: manager prepayment modal */}
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
            // Refetch Level 1 + Level 2 so prepaid/remaining update.
            await fetchLevel1()
            if (selectedStore) {
              // selectedStore reference still valid; re-run Level 2.
              const rematch = (await (async () => {
                try {
                  const r = await apiFetch(apiBase())
                  if (!r.ok) return null
                  const d = await r.json()
                  return (d.stores ?? []).find((x: StoreEntry) => x.counterpart_store_uuid === selectedStore.counterpart_store_uuid) ?? null
                } catch { return null }
              })()) as StoreEntry | null
              if (rematch) await fetchLevel2(rematch)
            }
          }}
        />
      )}
    </div>
  )
}
