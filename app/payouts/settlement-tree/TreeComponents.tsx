"use client"

/**
 * 정산 트리 — Sub-components.
 *
 * 2026-05-03: app/payouts/settlement-tree/page.tsx 분할.
 *   순수 표시 + 클릭 콜백만. 데이터 fetch / state 는 전부 부모.
 *
 * 포함:
 *   - DirectionTab     : [전체] [받을 돈] [줄 돈] 탭
 *   - EmptyState       : 데이터 없을 때
 *   - StoreCard        : 매장 카드 (펼침/접힘 + 실장 리스트)
 *   - StorePrimaryBadge: 매장 카드 우측 금액 배지
 *   - StoreSubline     : 매장 카드 보조정보
 *   - ManagerRow       : 실장 row (펼침 시 스태프 테이블)
 *   - ManagerPrimaryBadge: 실장 row 우측 금액 배지
 *   - HostessTable     : 스태프별 상세 테이블
 */

import {
  fmtTime,
  won,
  type DataBasis,
  type Direction,
  type HostessEntry,
  type ManagerEntry,
  type StoreEntry,
} from "./types"

export function DirectionTab({
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

export function EmptyState({
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

export function StoreCard({
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
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="이 매장 정산 내역을 트리에서 숨김 (soft delete)"
          className="nox-print-hide px-3 text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors text-[10px] border-l border-white/[0.04]"
        >
          내역삭제
        </button>
      </div>

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

export function StorePrimaryBadge({
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
  if (store.net_amount === 0) return <span className="text-slate-500 text-xs">±0</span>
  const positive = store.net_amount > 0
  return (
    <span className={`text-base font-bold ${positive ? "text-emerald-300" : "text-rose-300"}`}>
      {positive ? "+" : ""}
      {won(store.net_amount)}
    </span>
  )
}

export function StoreSubline({
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

export function ManagerRow({
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
              <span>줄 <span className="text-rose-300/90">{won(mgr.outbound_amount)}</span></span>
            )}
            {direction !== "outbound" && mgr.inbound_amount > 0 && (
              <span>받을 <span className="text-emerald-300/90">{won(mgr.inbound_amount)}</span></span>
            )}
            {isOperational && prepaid > 0 && direction !== "inbound" && (
              <span>선지급 <span className="text-amber-300">{won(prepaid)}</span></span>
            )}
            {isOperational && prepaid > 0 && direction !== "inbound" && (
              <span>잔액 <span className="text-slate-300">{won(remaining)}</span></span>
            )}
          </div>
        </button>
        {canPrepay && (direction === "outbound" || direction === "all") && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrepay() }}
            className="px-3 text-[11px] font-semibold text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border-l border-white/5"
            title="선지급 실행"
          >
            선지급
          </button>
        )}
      </div>

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

export function ManagerPrimaryBadge({
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
  if (mgr.net_amount === 0) return <span className="text-slate-500 text-xs">±0</span>
  const positive = mgr.net_amount > 0
  return (
    <span className={`text-sm font-bold ${positive ? "text-emerald-300" : "text-rose-300"}`}>
      {positive ? "+" : ""}
      {won(mgr.net_amount)}
    </span>
  )
}

export function HostessTable({
  hostesses,
  direction,
}: {
  hostesses: HostessEntry[]
  direction: Direction
}) {
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
              <span className="text-[8px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-300">줄</span>
            ) : (
              <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300">받을</span>
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
