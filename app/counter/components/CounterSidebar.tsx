"use client"

import { useEffect, useState } from "react"
import { fmtWon } from "../helpers"
import { apiFetch } from "@/lib/apiFetch"
import type { Room, DailySummary, BankAccount } from "../types"
import { useMenuConfig } from "../hooks/useMenuConfig"
import type { CounterMenuRole, MenuItemId } from "@/lib/counter/menu"
import CounterSettingsModal from "./settings/CounterSettingsModal"
import ReorderableMenuList from "./ReorderableMenuList"
import VersionBadge from "./VersionBadge"

/**
 * CounterSidebar — Phase C.
 *
 * 메뉴 렌더는 `useMenuConfig(role, storeUuid)` 로 위임한다. 결정 순서:
 *   1) COUNTER_MENU manifest + requiredRoles 필터 (항상 먼저 — 보안)
 *   2) user_preferences override (per_store → global) 의 hidden/order
 *   3) 저장값 없으면 DEFAULT_SIDEBAR_MENU (manifest 기본 순서)
 *
 * 저장값이 없을 때의 렌더 결과는 Phase B 이전의 role 매트릭스 기반
 * 인라인 배열과 완전히 동일하다. "카운터" 는 manifest 에서 togglable=false
 * 로 잠겨 있어서 사용자가 숨길 수 없다.
 *
 * Pure view + navigation. 데이터 fetch 는 소유하지 않는다.
 *
 * STEP: counter bottom-action (계좌선택 / 수금 / 외상) 은 기존과 동일 —
 * focused 일 때만 렌더, menu config 와 무관.
 */

type Props = {
  open: boolean
  onClose: () => void
  rooms: Room[]
  dailySummary: DailySummary | null
  currentRole: string | null
  /** Phase C — per-store preferences override 를 위해 필요. 생략 시 global/기본. */
  currentStoreUuid?: string | null
  /** super-admin 여부 — 전역 강제 override 조작 권한. 생략 시 false. */
  isSuperAdmin?: boolean
  onNavigate: (path: string) => void

  focused?: boolean
  selectedAccount?: BankAccount | null
  onOpenAccountPicker?: () => void
  onOpenCreditSettlement?: () => void
  onOpenCreditRegister?: () => void
}

export default function CounterSidebar({
  open, onClose, rooms, dailySummary, currentRole, currentStoreUuid = null, isSuperAdmin = false, onNavigate,
  focused = false,
  selectedAccount = null,
  onOpenAccountPicker,
  onOpenCreditSettlement,
  onOpenCreditRegister,
}: Props) {
  const activeCount = rooms.filter(r => r.session?.status === "active").length
  const emptyCount = rooms.filter(r => !r.session).length
  const liveGrossTotal = rooms.reduce((sum, r) => sum + (r.session?.gross_total ?? 0), 0)
  const liveOrderTotal = rooms.reduce((sum, r) => sum + (r.session?.order_total ?? 0), 0)
  const liveParticipantTotal = rooms.reduce((sum, r) => sum + (r.session?.participant_total ?? 0), 0)

  // 2026-04-25: 미수(pending credits) 총액 실시간 연동. 이전엔 0 하드코딩.
  //   sidebar 가 열릴 때 + 매 분마다 갱신. 대시보드/계좌 모달과 독립 fetch.
  const [creditsTotal, setCreditsTotal] = useState(0)
  // 2026-04-25: 사이드바 메뉴 알림 배지 — owner 전용.
  //   감시 메뉴에 urgency 점, 이슈 메뉴에 open count.
  const [issueOpenCount, setIssueOpenCount] = useState(0)
  const [watchdogUrgent, setWatchdogUrgent] = useState(false)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function fetchPending() {
      try {
        const res = await apiFetch("/api/credits?status=pending")
        if (!res.ok) return
        const data = (await res.json().catch(() => ({}))) as {
          credits?: { amount: number }[]
        }
        if (cancelled) return
        const sum = (data.credits ?? []).reduce(
          (s, c) => s + (typeof c.amount === "number" ? c.amount : 0),
          0,
        )
        setCreditsTotal(sum)
      } catch { /* ignore — 실패 시 이전 값 유지 */ }
    }
    async function fetchOpsBadges() {
      if (currentRole !== "owner") return
      try {
        const [issRes, wdRes] = await Promise.all([
          apiFetch("/api/issues?status=open,in_review").catch(() => null),
          apiFetch("/api/telemetry/watchdog").catch(() => null),
        ])
        if (cancelled) return
        if (issRes?.ok) {
          const data = await issRes.json().catch(() => ({}))
          const issues = Array.isArray(data.issues) ? data.issues : []
          setIssueOpenCount(issues.length)
        }
        if (wdRes?.ok) {
          const w = await wdRes.json().catch(() => ({}))
          const a = w.auth_anomalies_24h ?? {}
          const d = w.data_anomalies ?? {}
          const i = w.open_issues_by_severity ?? {}
          const urgent =
            (a.membership_invalid ?? 0) > 0 ||
            (d.duplicate_active_per_room ?? 0) > 0 ||
            (d.long_running_sessions ?? 0) > 0 ||
            (i.critical ?? 0) > 0
          setWatchdogUrgent(urgent)
        }
      } catch { /* ignore */ }
    }
    fetchPending()
    fetchOpsBadges()
    const t1 = setInterval(fetchPending, 60_000)
    const t2 = setInterval(fetchOpsBadges, 5 * 60_000)
    return () => { cancelled = true; clearInterval(t1); clearInterval(t2) }
  }, [open, currentRole])

  // 타임 매출 (스태프 타임) = 총 매출 − 주문 매출. 세션별로 이미 분리돼 있어
  //   직접 합산 가능. live + closed 모두 포함. 닫힌 세션의 participant_total
  //   은 dailySummary 에 포함돼 있음 (rooms.ts 참여자 합산 기반).
  const totalGross = liveGrossTotal + (dailySummary?.gross_total ?? 0)
  const totalOrder = liveOrderTotal + (dailySummary?.order_total ?? 0)
  const totalTime  = liveParticipantTotal + (dailySummary?.participant_total ?? 0)

  // Role 타입 정규화 — useMenuConfig 는 CounterMenuRole 만 허용.
  const normalizedRole: CounterMenuRole | null = (() => {
    switch (currentRole) {
      case "owner":
      case "manager":
      case "waiter":
      case "staff":
      case "hostess":
        return currentRole
      default:
        return null
    }
  })()

  const { items, config, setConfig } = useMenuConfig(normalizedRole, currentStoreUuid)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 드래그 리오더 → user prefs 저장.
  // visible items 의 새 순서 + 기존 hidden 항목 (순서 보존) = 새 config.order
  function handleReorder(newVisibleIds: string[]) {
    const visibleSet = new Set(newVisibleIds)
    const hiddenInOrder = config.order.filter(id => !visibleSet.has(id))
    const nextOrder = [...newVisibleIds, ...hiddenInOrder] as MenuItemId[]
    setConfig({ ...config, order: nextOrder }).catch(() => { /* 사용자 보일 에러는 settings 모달이 처리 */ })
  }

  // 현재 활성 탭 — 기존에는 { path: "/counter", active: true } 로 하드코딩.
  // manifest 기반에서는 path 매칭으로 표현.
  const activePath = "/counter"

  const showActions = focused && (onOpenAccountPicker || onOpenCreditSettlement || onOpenCreditRegister)

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />}
      <aside className={`fixed top-0 left-0 h-full w-72 bg-[#0d1020] border-r border-white/10 z-50 transition-transform duration-200 flex flex-col ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <span className="text-base font-bold">NOX</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>

        {/* R-Ver: 버전/배포 배지. 사이드바 상단 고정. flex-shrink-0 라 스크롤 영향 없음. */}
        <div className="flex-shrink-0">
          <VersionBadge />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-4 border-b border-white/10">
            <div className="text-[11px] text-slate-500 mb-2">방 현황</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "전체", val: rooms.length, cls: "text-cyan-300" },
                { label: "사용중", val: activeCount, cls: "text-red-300" },
                { label: "광토", val: 0, cls: "text-amber-300" },
                { label: "비어있음", val: emptyCount, cls: "text-emerald-300" },
              ].map(s => (
                <div key={s.label} className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2">
                  <div className="text-[10px] text-slate-500">{s.label}</div>
                  <div className={`text-lg font-bold ${s.cls}`}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>
          {/* 2026-04-25: 매출 블록 클릭 → 상세 매출표.
              owner → /reports (일일/스태프/실장 탭 상세)
              manager → /payouts/settlement-tree (본인 담당 정산 트리)
              외 role → 비활성 (커서 안 바뀜).
              미수 줄은 /customers?tab=credits (실제로는 /credits 이동). */}
          <div className="px-5 py-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-500">
                오늘 매출 <span className="text-[9px] text-slate-600">(실시간)</span>
              </span>
              {(currentRole === "owner" || currentRole === "manager") && (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onNavigate(
                      currentRole === "owner"
                        ? "/reports"
                        : "/payouts/settlement-tree",
                    )
                  }}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300"
                >
                  상세 →
                </button>
              )}
            </div>
            <div className="space-y-2">
              {/* 총 매출 = 타임 매출 + 주문 매출. 셋 다 같은 소스에서 파생.
                  미수는 /api/credits?status=pending 실시간 합산. */}
              {[
                {
                  label: "총 매출", value: fmtWon(totalGross), cls: "text-emerald-300",
                  target: currentRole === "owner" ? "/reports"
                    : currentRole === "manager" ? "/payouts/settlement-tree"
                    : null,
                },
                {
                  label: "├ 타임 매출", value: fmtWon(totalTime), cls: "text-cyan-300",
                  target: currentRole === "owner" ? "/reports"
                    : currentRole === "manager" ? "/payouts/settlement-tree"
                    : null,
                },
                {
                  label: "└ 주문 매출", value: fmtWon(totalOrder), cls: "text-amber-300",
                  target: currentRole === "owner" ? "/reports"
                    : currentRole === "manager" ? "/payouts/settlement-tree"
                    : null,
                },
                {
                  label: "미수",
                  value: fmtWon(creditsTotal),
                  cls: creditsTotal > 0 ? "text-red-400" : "text-slate-500",
                  target: "/credits",
                },
              ].map(s => {
                const clickable = !!s.target
                return (
                  <button
                    key={s.label}
                    type="button"
                    disabled={!clickable}
                    onClick={() => {
                      if (!s.target) return
                      onClose()
                      onNavigate(s.target)
                    }}
                    className={`w-full flex items-center justify-between rounded px-1 py-0.5 -mx-1 transition-colors ${
                      clickable ? "hover:bg-white/[0.04] cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <span className="text-[11px] text-slate-400">{s.label}</span>
                    <span className={`text-sm font-bold ${s.cls}`}>{s.value}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <nav className="px-3 py-3">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] text-slate-500">메뉴</span>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="text-[10px] text-slate-500 hover:text-cyan-300 px-1.5 py-0.5 rounded"
                title="커스터마이징"
              >⚙︎ 설정</button>
            </div>
            <ReorderableMenuList
              items={items}
              activePath={activePath}
              badgeFor={(m) => ({
                count: m.id === "issues" ? issueOpenCount : 0,
                dot: m.id === "watchdog" && watchdogUrgent,
              })}
              onItemClick={(m) => { onClose(); if (m.path !== "#") onNavigate(m.path) }}
              onReorder={handleReorder}
            />
            <div className="px-2 mt-2 text-[10px] text-slate-600">우측 ≡ 핸들을 꾹 누른 채로 드래그하면 순서 변경</div>
          </nav>
        </div>

        {/* Pinned bottom actions — previously three floating buttons on the
            counter page. Only shown when a room is in focus. */}
        {showActions && (
          <div className="flex-shrink-0 border-t border-white/10 p-3 space-y-2 bg-[#0d1020]">
            <div className="text-[11px] text-slate-500 px-1 mb-1">선택된 방 동작</div>
            {onOpenAccountPicker && (
              <button
                type="button"
                onClick={onOpenAccountPicker}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-cyan-500/85 hover:bg-cyan-500 border border-cyan-400/50 active:scale-[0.98] transition-all"
                title={selectedAccount ? `${selectedAccount.bank_name} · ${selectedAccount.holder_name}` : "계좌 선택"}
              >
                <span>계좌선택</span>
                <span className="text-[10px] opacity-90 truncate max-w-[140px]">
                  {selectedAccount
                    ? `${selectedAccount.bank_name} · ${selectedAccount.holder_name}`
                    : "미선택"}
                </span>
              </button>
            )}
            {onOpenCreditSettlement && (
              <button
                type="button"
                onClick={onOpenCreditSettlement}
                className="w-full px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-emerald-600/85 hover:bg-emerald-600 border border-emerald-500/50 active:scale-[0.98] transition-all"
              >수금</button>
            )}
            {onOpenCreditRegister && (
              <button
                type="button"
                onClick={onOpenCreditRegister}
                className="w-full px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-amber-500/90 hover:bg-amber-500 border border-amber-400/50 active:scale-[0.98] transition-all"
              >외상</button>
            )}
          </div>
        )}
      </aside>

      <CounterSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        role={normalizedRole}
        storeUuid={currentStoreUuid}
        isSuperAdmin={isSuperAdmin}
      />
    </>
  )
}
