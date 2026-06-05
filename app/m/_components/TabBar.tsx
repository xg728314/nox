"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "../_lib/cn"

const TABS = [
  { href: "/m", label: "홈", icon: "🏠", match: (p: string) => p === "/m" },
  { href: "/m/staff", label: "스태프", icon: "👥", match: (p: string) => p.startsWith("/m/staff") || p.startsWith("/m/attendance") },
  { href: "/m/chat", label: "채팅", icon: "💬", match: (p: string) => p.startsWith("/m/chat") },
  { href: "/m/settle", label: "정산", icon: "📊", match: (p: string) => p.startsWith("/m/settle") },
  { href: "/m/me", label: "내정보", icon: "⚙️", match: (p: string) => p.startsWith("/m/me") || p.startsWith("/m/store") },
] as const

export function TabBar({ chatUnread = false }: { chatUnread?: boolean }) {
  const pathname = usePathname() ?? "/m"
  return (
    <nav
      className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-[#D8D2C8] z-30"
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
