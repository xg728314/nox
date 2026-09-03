"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "../_lib/cn"
import { useMe } from "../_hooks/useMobileData"
import { PERMS } from "@/lib/auth/permissions"

// R-tabbar-chat-first (2026-08-23): 실 흐름 = 카톡 위주 → 채팅 을 홈 (첫 탭) 으로.
//   유흥업소 실장 표준 흐름: 카톡 열기 → 초이스/메이드 얘기 → 팅 → 정산.
//   조판/외부조판 은 결과 화면 · 채팅이 primary interface.
//   되돌리려면 이 커밋 revert (git revert <hash>).
//
// R-manager-perms (2026-09-04): 각 탭에 required permission 지정.
//   사장이 실장한테 「채팅만」 위임하면 → 채팅 + 전체메뉴 탭만 표시.
//   전체메뉴 는 로그아웃/프로필 접근 필수 → 항상 표시.
const TABS: Array<{
  href: string; label: string; icon: string;
  match: (p: string) => boolean;
  requires?: string // permission key
}> = [
  { href: "/m/chat", label: "채팅", icon: "💬", match: (p: string) => p.startsWith("/m/chat"), requires: PERMS.CHAT_VIEW },
  { href: "/m", label: "조판", icon: "🏠", match: (p: string) => p === "/m", requires: PERMS.ROSTER_VIEW },
  { href: "/m/staff", label: "외부조판", icon: "🏢", match: (p: string) => p.startsWith("/m/staff") || p.startsWith("/m/attendance"), requires: PERMS.STAFF_VIEW },
  { href: "/m/settle", label: "정산", icon: "📊", match: (p: string) => p.startsWith("/m/settle"), requires: PERMS.SETTLE_VIEW },
  { href: "/m/me", label: "전체메뉴", icon: "☰", match: (p: string) => p.startsWith("/m/me") || p.startsWith("/m/store") /* 항상 표시 (로그아웃 필수) */ },
]

export function TabBar({ chatUnread = false }: { chatUnread?: boolean }) {
  const pathname = usePathname() ?? "/m"
  const { data: me } = useMe()

  // R-manager-perms: permissions 로드 전에는 모든 탭 표시 (loading flash 방지).
  //   `me?.permissions` 가 있으면 permission-gated 탭만 필터.
  const permissions = me?.permissions
  const visibleTabs = TABS.filter(t => {
    if (!t.requires) return true // 전체메뉴 등 unrestricted
    if (!permissions) return true // 아직 로드 안 됐거나 hostess 등
    return permissions[t.requires] === true
  })

  return (
    // R-tabbar-fixed-in-frame (2026-07-24): 콘텐츠 스크롤/길이와 무관하게
    //   항상 phone frame 하단에 anchored. PhoneFrame md container 가
    //   translateZ(0) 로 containing block 을 형성 → 이 fixed 는 frame 기준.
    //   모바일 (< md) 에서는 viewport 하단 (동일 UX).
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-[#D8D2C8] z-40"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-stretch px-2 pt-2">
        {visibleTabs.map((t) => {
          const active = t.match(pathname)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-1 relative transition-colors",
                active ? "text-[#2D2B26]" : "text-[#7A746A]",
              )}
            >
              <span className="text-[20px] leading-none">{t.icon}</span>
              <span className={cn("text-[10px] font-bold tracking-tight", active && "text-[#C49B61]")}>
                {t.label}
              </span>
              {t.label === "채팅" && chatUnread && (
                <span className="absolute top-0.5 right-1/3 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
