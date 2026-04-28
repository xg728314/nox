"use client"

/**
 * 사이드바 메뉴 — 단순 button 리스트.
 *
 * 2026-04-29: 우측 ≡ 핸들 + long-press drag 제거 (사용자 피드백: 지저분).
 *   순서 변경은 ⚙ 설정 → 사이드바 메뉴 탭 에서만 가능 (DragReorderList).
 *   onReorder prop 은 backward-compat 위해 유지하되 더는 호출되지 않음.
 *
 * 책임:
 *   - items 순서대로 메뉴 버튼 렌더 (이미 useMenuConfig 가 user prefs 반영한 순서)
 *   - 활성 path 강조
 *   - badge (이슈 카운트, watchdog 빨간점) 표시
 *   - 클릭 → onItemClick(navigation)
 */

import type { MenuItemDefinition } from "@/lib/counter/menu"

type Props = {
  items: MenuItemDefinition[]
  activePath: string
  badgeFor: (m: MenuItemDefinition) => { count: number; dot: boolean }
  onItemClick: (m: MenuItemDefinition) => void
  /** Deprecated — kept for backward compatibility, no longer invoked. */
  onReorder?: (newOrderIds: string[]) => void
}

export default function ReorderableMenuList({
  items, activePath, badgeFor, onItemClick,
}: Props) {
  return (
    <div>
      {items.map((m) => {
        const active = m.path === activePath
        const { count, dot } = badgeFor(m)

        return (
          <div key={m.id} className="mb-1">
            <button
              onClick={() => onItemClick(m)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
                active
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <span className="text-base relative">
                {m.icon}
                {dot && (
                  <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </span>
              <span className="flex-1 text-left">{m.label}</span>
              {count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/25 text-red-300 border border-red-500/40">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
