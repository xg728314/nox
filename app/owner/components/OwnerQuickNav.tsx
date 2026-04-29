"use client"

/**
 * Owner page 의 빠른 이동 그리드.
 *
 * R28-refactor: app/owner/page.tsx 가 800+ 줄이라 일부 발췌 분할.
 *   이 컴포넌트는 16개 메뉴 타일을 렌더하고 chat 미열람 배지 표시.
 *
 * 추후 lib/counter/menu.ts 의 manifest 와 통합 가능 (현재는 owner 가
 * 보는 모든 메뉴를 한 화면에 띄워야 하므로 별도 list 유지).
 */

import { useRouter } from "next/navigation"

type NavItem = { label: string; path: string; icon: string }

const NAV_ITEMS: readonly NavItem[] = [
  { label: "관제", path: "/admin", icon: "📡" },
  { label: "리포트", path: "/reports", icon: "📊" },
  { label: "카운터", path: "/counter", icon: "🖥️" },
  { label: "배정", path: "/attendance", icon: "📋" },
  { label: "감사 로그", path: "/audit", icon: "📜" },
  { label: "재무", path: "/finance", icon: "💰" },
  { label: "매장 정산", path: "/owner/settlement", icon: "📊" },
  { label: "지급 관리", path: "/payouts", icon: "💸" },
  { label: "정산 이력", path: "/settlement/history", icon: "📒" },
  { label: "고객·외상", path: "/customers", icon: "👥" },
  { label: "이적 관리", path: "/transfer", icon: "🔄" },
  { label: "재고", path: "/inventory", icon: "📦" },
  { label: "채팅", path: "/chat", icon: "💬" },
  { label: "감시 대시보드", path: "/ops/watchdog", icon: "🛡️" },
  { label: "이슈 신고함", path: "/ops/issues", icon: "🐞" },
  // "에러 모니터" 진입점 제거 — 감시 대시보드의 에러 카드 클릭으로 drill-down 가능 (중복 진입점 정리).
  // /ops/errors 페이지 자체와 API 는 유지.
  { label: "종이장부 대조", path: "/reconcile", icon: "📑" },
  { label: "운영 설정", path: "/ops", icon: "⚙️" },
  // super_admin 전용 — visualizeGate 가 비-super_admin 클릭은 401/403 처리.
  { label: "네트워크 맵", path: "/super-admin/visualize/network", icon: "🕸️" },
]

export default function OwnerQuickNav({ chatUnread }: { chatUnread: number }) {
  const router = useRouter()
  return (
    <div className="grid grid-cols-3 gap-3">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.path}
          onClick={() => router.push(item.path)}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08] transition-colors relative"
        >
          <div className="text-xl mb-2">{item.icon}</div>
          {item.label === "채팅" && chatUnread > 0 && (
            <span className="absolute top-2 right-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {chatUnread > 99 ? "99+" : chatUnread}
            </span>
          )}
          <div className="text-sm font-medium text-slate-200">{item.label}</div>
        </button>
      ))}
    </div>
  )
}
