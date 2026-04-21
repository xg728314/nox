"use client"

import { useState } from "react"
import { fmtWon } from "../helpers"
import type { Room, DailySummary, BankAccount } from "../types"
import { useMenuConfig } from "../hooks/useMenuConfig"
import type { CounterMenuRole } from "@/lib/counter/menu"
import CounterSettingsModal from "./settings/CounterSettingsModal"

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

  const { items } = useMenuConfig(normalizedRole, currentStoreUuid)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
          <div className="px-5 py-4 border-b border-white/10">
            <div className="text-[11px] text-slate-500 mb-2">오늘 매출 <span className="text-[9px] text-slate-600">(실시간)</span></div>
            <div className="space-y-2">
              {[
                { label: "총 매출", value: fmtWon(liveGrossTotal + (dailySummary?.gross_total ?? 0)), cls: "text-emerald-300" },
                { label: "주문 매출", value: fmtWon(liveOrderTotal + (dailySummary?.order_total ?? 0)), cls: "text-amber-300" },
                { label: "미수", value: fmtWon(0), cls: "text-red-400" },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{s.label}</span>
                  <span className={`text-sm font-bold ${s.cls}`}>{s.value}</span>
                </div>
              ))}
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
            {items.map(m => {
              const active = m.path === activePath
              return (
                <button
                  key={m.id}
                  onClick={() => { onClose(); if (m.path !== "#") onNavigate(m.path) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 ${active ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:bg-white/5"}`}
                >
                  <span className="text-base">{m.icon}</span>{m.label}
                </button>
              )
            })}
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
