"use client"
import Link from "next/link"
import { type ReactNode } from "react"

export function PageHeader({
  title,
  subtitle,
  backHref,
  right,
}: {
  title: string
  subtitle?: string
  backHref?: string
  right?: ReactNode
}) {
  return (
    <header
      className="sticky top-0 z-20 bg-[#F8F4ED]/95 backdrop-blur-md px-4 pb-3 flex items-center gap-3 border-b border-[#D8D2C8]/50"
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label="뒤로"
          className="w-9 h-9 rounded-full bg-white border border-[#D8D2C8] flex items-center justify-center text-[#2D2B26] text-[15px] no-underline shrink-0"
        >
          ←
        </Link>
      )}
      <div className="flex-1 text-center min-w-0">
        <div className="text-[16px] font-extrabold tracking-tight text-[#2D2B26] truncate">{title}</div>
        {subtitle && (
          <div className="text-[10px] font-semibold text-[#7A746A] mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">{right}</div>
    </header>
  )
}
