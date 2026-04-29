"use client"

/**
 * Manager 페이지 하단 네비 — 7개 탭.
 *
 * R28-refactor: app/manager/page.tsx 가 705줄이라 분할.
 *
 * /ops 는 owner 전용이라 manager 네비에서 제외 (middleware 가 307 튕김).
 * 나머지는 OWNER_MANAGER_PREFIXES 통과.
 */

import { useRouter } from "next/navigation"

type Tab = { label: string; icon: string; path: string }

const TABS: readonly Tab[] = [
  { label: "카운터", icon: "⊞", path: "/counter" },
  { label: "배정", icon: "📋", path: "/attendance" },
  { label: "내 정산", icon: "💰", path: "/manager/settlement" },
  { label: "내 수익", icon: "📒", path: "/manager/ledger" },
  { label: "지급", icon: "💸", path: "/payouts" },
  { label: "고객·외상", icon: "👥", path: "/customers" },
  { label: "채팅", icon: "💬", path: "/chat" },
  { label: "내 정보", icon: "👤", path: "/me" },
]

export default function ManagerBottomNav({ chatUnread }: { chatUnread: number }) {
  const router = useRouter()
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
      <div className="grid grid-cols-8 py-2">
        {TABS.map((item) => (
          <button
            key={item.label}
            onClick={() => router.push(item.path)}
            className={`flex flex-col items-center py-2 gap-1 text-xs relative ${item.path === "/manager" ? "text-cyan-400" : "text-slate-500"}`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
            {item.label === "채팅" && chatUnread > 0 && (
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
