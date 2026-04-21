"use client"

/**
 * BottomNavStrip — 하단 네비게이션 + BLE 연결 상태.
 *
 * Tabs are VISUAL shortcuts to existing product surfaces where a route
 * exists. Non-existent destinations render as inactive labels so the
 * strip matches the target layout without introducing dead links.
 */

type Tab = {
  id: string
  label: string
  icon: string
  href?: string
}

const TABS: Tab[] = [
  { id: "counter",    label: "카운터",      icon: "🧍", href: "/counter" },
  { id: "rooms",      label: "방 관리",     icon: "🏠" },                         // no dedicated route yet
  { id: "orders",     label: "주문 관리",   icon: "📋" },                         // no dedicated route yet
  { id: "settlement", label: "정산 관리",   icon: "🧾", href: "/payouts/settlement-tree" },
  { id: "staff",      label: "스태프",      icon: "👤", href: "/staff" },
  { id: "reports",    label: "매출 리포트", icon: "📈", href: "/reports/overview" },
  { id: "ble",        label: "BLE 관리",    icon: "📡", href: "/ble" },
]

type Props = {
  activeId?: string
  bleGatewayCount?: number
  manualEnabled?: boolean
}

export default function BottomNavStrip({
  activeId = "counter", bleGatewayCount, manualEnabled = true,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-white/[0.06] bg-[#0b0e1c]">
      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map(t => {
          const active = t.id === activeId
          const disabled = !t.href
          const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
          const style = active
            ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
            : disabled
              ? "text-slate-600 cursor-not-allowed"
              : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
          return t.href
            ? (
              <a key={t.id} href={t.href} className={`${base} ${style}`}>
                <span className="text-[12px]">{t.icon}</span>{t.label}
              </a>
            ) : (
              <span key={t.id} className={`${base} ${style}`} title="추후 연결 예정">
                <span className="text-[12px]">{t.icon}</span>{t.label}
              </span>
            )
        })}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          BLE 연결: <span className="font-bold tabular-nums">{bleGatewayCount ?? "—"}</span>
        </span>
        {manualEnabled && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            수동 입력 가능
          </span>
        )}
      </div>
    </div>
  )
}
