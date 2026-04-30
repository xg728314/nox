"use client"

/**
 * Owner page 의 빠른 이동 그리드.
 *
 * R28-refactor: app/owner/page.tsx 가 800+ 줄이라 일부 발췌 분할.
 *   이 컴포넌트는 메뉴 타일을 렌더하고 chat 미열람 배지 표시.
 *
 * 2026-04-30: NavItem.requireSuperAdmin 추가. 운영자 전용 메뉴 (네트워크
 *   맵 등) 는 일반 사장 화면에서 숨김. 페이지 자체는 server-side gate 가
 *   별도로 차단.
 */

import { useRouter } from "next/navigation"

type NavItem = {
  label: string
  path: string
  icon: string
  /** true 면 super_admin 인 사용자만 메뉴에 노출. */
  requireSuperAdmin?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: "관제", path: "/admin", icon: "📡" },
  { label: "리포트", path: "/reports", icon: "📊" },
  { label: "카운터", path: "/counter", icon: "🖥️" },
  { label: "배정", path: "/attendance", icon: "📋" },
  { label: "감사 로그", path: "/audit", icon: "📜" },
  // 2026-04-30: 재무 관련 진입점 일원화. 매장 정산 / 지급 관리 / 정산 이력
  //   3개 직접 진입 타일을 제거하고 /finance 허브에서만 분기하도록 함.
  //   페이지 자체 (/owner/settlement, /payouts, /settlement/history) 는
  //   그대로 유지 — 검증된 기존 화면이고 답하는 질문/도메인이 분리되어
  //   있어 통합은 부적절. 진입점만 단일화로 운영자 멘탈 모델 단순.
  { label: "재무", path: "/finance", icon: "💰" },
  { label: "고객·외상", path: "/customers", icon: "👥" },
  { label: "이적 관리", path: "/transfer", icon: "🔄" },
  { label: "재고", path: "/inventory", icon: "📦" },
  { label: "채팅", path: "/chat", icon: "💬" },
  { label: "감시 대시보드", path: "/ops/watchdog", icon: "🛡️" },
  { label: "이슈 신고함", path: "/ops/issues", icon: "🐞" },
  // "에러 모니터" 진입점 제거 — 감시 대시보드의 에러 카드 클릭으로 drill-down 가능 (중복 진입점 정리).
  // /ops/errors 페이지 자체와 API 는 유지.
  { label: "종이장부 (방별)", path: "/reconcile", icon: "📑" },
  { label: "스태프 장부", path: "/reconcile/staff", icon: "👥" },
  { label: "운영 설정", path: "/ops", icon: "⚙️" },
  // 2026-04-30: 운영자 전용 (super_admin only). 일반 사장에게는 메뉴 자체
  //   숨김. 페이지 자체는 visualizeGate 가 비-super_admin 401/403 처리.
  { label: "네트워크 맵", path: "/super-admin/visualize/network", icon: "🕸️", requireSuperAdmin: true },
]

type Props = {
  chatUnread: number
  /** 사용자가 super_admin 인지. 비-super_admin 에게는 운영자 전용 타일 숨김. */
  isSuperAdmin?: boolean
}

export default function OwnerQuickNav({ chatUnread, isSuperAdmin = false }: Props) {
  const router = useRouter()
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.requireSuperAdmin || isSuperAdmin,
  )
  return (
    <div className="grid grid-cols-3 gap-3">
      {visibleItems.map((item) => (
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
