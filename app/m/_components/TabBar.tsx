"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "../_lib/cn"

const TABS = [
  { href: "/m", label: "홈", icon: "🏠", match: (p: string) => p === "/m" },
  { href: "/m/staff", label: "스태프", icon: "👥", match: (p: string) => p.startsWith("/m/staff") || p.startsWith("/m/attendance") },
  { href: "/m/chat", label: "채팅", icon: "💬", match: (p: string) => p.startsWith("/m/chat") },
  { href: "/m/settle", label: "정산", icon: "📊", match: (p: string) => p.startsWith("/m/settle") },
  { href: "/m/me", label: "전체메뉴", icon: "☰", match: (p: string) => p.startsWith("/m/me") || p.startsWith("/m/store") },
] as const

export function TabBar({ chatUnread = false }: { chatUnread?: boolean }) {
  const pathname = usePathname() ?? "/m"
  return (
    // 2026-06-12 R-tabbar-fixed: 콘텐츠 짧을 때 sticky 가 스크롤 컨테이너 끝에
    //   붙어서 탭바가 화면 중간 위로 올라오는 현상 fix.
    //   - 페이지 컨테이너는 flex flex-col min-h-full (각 페이지)
    //   - mt-auto: 부모 flex-col 안에서 위 모든 공간 흡수 → 탭바 항상 bottom.
    //   - sticky bottom-0: 콘텐츠 긴 페이지에서도 항상 viewport bottom 에 보임.
    <nav
      className="mt-auto sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-[#D8D2C8] z-30"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-stretch px-2 pt-2">
        {TABS.map((t) => {
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
