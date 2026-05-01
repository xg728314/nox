"use client"

/**
 * Manager 페이지 하단 네비.
 *
 * 2026-04-30: 종이장부 항목 추가 (9개 탭).
 * 2026-05-01 R-Manager-Permissions: 메뉴 단위 권한 토글.
 *   - mount 시 /api/me/menu-permissions fetch.
 *   - permissions[key] === false 인 메뉴는 hide.
 *   - 사장이 /staff 의 실장 권한 modal 에서 토글 → 다음 mount 부터 반영.
 *   - default ON (row 없거나 명시 X → 모든 메뉴 표시).
 *
 * 보안 주의 (Phase 1):
 *   본 NaV 는 UI hide 만 수행. URL 직접 입력은 통과.
 *   완전 차단은 별도 라운드 (middleware + API server-side 검증).
 *
 * /ops 는 owner 전용이라 manager 네비에서 제외 (middleware 307 튕김).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import {
  MANAGER_MENU_KEYS,
  MANAGER_MENU_LABELS,
  MANAGER_MENU_PATHS,
  type ManagerMenuKey,
} from "@/lib/auth/managerMenuPermissions"

const ICONS: Record<ManagerMenuKey, string> = {
  counter: "⊞",
  attendance: "📋",
  my_settlement: "💰",
  my_ledger: "📒",
  payouts: "💸",
  customers: "👥",
  staff_ledger: "📑",
  chat: "💬",
  my_info: "👤",
}

const TABS = MANAGER_MENU_KEYS.map((k) => ({
  key: k,
  label: MANAGER_MENU_LABELS[k],
  icon: ICONS[k],
  path: MANAGER_MENU_PATHS[k],
}))

export default function ManagerBottomNav({ chatUnread }: { chatUnread: number }) {
  const router = useRouter()
  const [menuMap, setMenuMap] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch("/api/me/menu-permissions")
        if (cancelled) return
        if (r.ok) {
          const d = await r.json()
          if (d.menu_map && typeof d.menu_map === "object") {
            setMenuMap(d.menu_map as Record<string, boolean>)
          }
        }
      } catch { /* fetch 실패 시 default ON 가정 */ }
    })()
    return () => { cancelled = true }
  }, [])

  // menuMap === null → fetch 전 또는 fail-open. 모든 메뉴 표시 (default ON).
  const visibleTabs = menuMap
    ? TABS.filter((t) => menuMap[t.key] !== false)
    : TABS

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
      <div className="grid grid-cols-5 md:grid-cols-9 py-2 gap-x-0">
        {visibleTabs.map((item) => (
          <button
            key={item.key}
            onClick={() => router.push(item.path)}
            className={`flex flex-col items-center py-2 gap-1 text-[11px] relative ${
              item.path === "/manager" ? "text-cyan-400" : "text-slate-500"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
            {item.key === "chat" && chatUnread > 0 && (
              <span className="absolute top-0.5 right-1 bg-red-500 text-white text-[10px] px-1 py-0 rounded-full min-w-[16px] text-center leading-4">
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
