"use client"

/**
 * Manager 페이지 하단 네비.
 *
 * 2026-04-30: 종이장부 항목 추가 (9개 탭). 실장이 본인 담당 스태프의
 *   장부 사진을 직접 업로드해 누락 / AI 인식률 보정에 기여하도록.
 *
 * 모바일 9 columns 는 좁아서 grid 를 두 줄 (5+4) 로 분할. 각 탭은 최소
 *   44px 높이 (Apple HIG 권장 tap target) 충족. desktop 에서는 한 줄로.
 *
 * /ops 는 owner 전용이라 manager 네비에서 제외 (middleware 307 튕김).
 *   나머지는 OWNER_MANAGER_PREFIXES 통과.
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
  // 실장 주 use-case = 본인 담당 스태프의 일별 근무표 등록 → /reconcile/staff 로 직행.
  // 방별 장부 (/reconcile) 가 필요하면 그 화면 헤더에서 토글 가능.
  { label: "스태프장부", icon: "📑", path: "/reconcile/staff" },
  { label: "채팅", icon: "💬", path: "/chat" },
  { label: "내 정보", icon: "👤", path: "/me" },
]

export default function ManagerBottomNav({ chatUnread }: { chatUnread: number }) {
  const router = useRouter()
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
      {/* 9 cols on >=md (한 줄), 5 cols on mobile (두 줄). */}
      <div className="grid grid-cols-5 md:grid-cols-9 py-2 gap-x-0">
        {TABS.map((item) => (
          <button
            key={item.label}
            onClick={() => router.push(item.path)}
            className={`flex flex-col items-center py-2 gap-1 text-[11px] relative ${
              item.path === "/manager" ? "text-cyan-400" : "text-slate-500"
            }`}
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
