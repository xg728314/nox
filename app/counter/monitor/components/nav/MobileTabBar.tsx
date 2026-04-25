"use client"

/**
 * MobileTabBar — bottom-fixed tab switcher used on the mobile shell.
 * Replaces the `BottomNavStrip` on narrow screens because product
 * navigation (/counter 등) is secondary on mobile — the priority is
 * switching between monitoring sections.
 */

import type { MonitorMobileTab } from "@/lib/counter/monitorLayoutTypes"

type Props = {
  tab: MonitorMobileTab
  badgeCounts?: Partial<Record<MonitorMobileTab, number>>
  onChange: (t: MonitorMobileTab) => void
}

const TABS: Array<{ id: MonitorMobileTab; label: string; icon: string }> = [
  { id: "rooms",   label: "방 목록", icon: "🏠" },
  { id: "map",     label: "미니맵",  icon: "🗺" },
  { id: "workers", label: "인원",    icon: "👥" },
  { id: "alerts",  label: "알림",    icon: "🔔" },
]

export default function MobileTabBar({ tab, badgeCounts, onChange }: Props) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-white/[0.08] bg-[#0b0e1c] shadow-[0_-4px_24px_rgba(0,0,0,0.5)]"
      aria-label="모니터 섹션 전환"
    >
      {TABS.map(t => {
        const active = tab === t.id
        const badge = badgeCounts?.[t.id]
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors ${
              active ? "text-cyan-300" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className="text-[15px] leading-none">{t.icon}</span>
            <span className="font-semibold">{t.label}</span>
            {active && (
              <span className="absolute top-0 left-4 right-4 h-[2px] bg-cyan-400 rounded-b" />
            )}
            {badge && badge > 0 && (
              <span className="absolute top-1 right-[20%] min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
