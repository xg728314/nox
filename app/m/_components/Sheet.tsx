"use client"
import { type ReactNode, useEffect } from "react"
import { cn } from "../_lib/cn"

/**
 * Bottom sheet (모달).
 * - open=true 시 슬라이드업.
 * - backdrop 클릭으로 닫힘.
 * - Escape 키로도 닫힘.
 * - 모바일 safe-area-inset-bottom 패딩.
 */
export function Sheet({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  maxHeight = "88vh",
}: {
  open: boolean
  onClose: () => void
  title?: string
  desc?: string
  children: ReactNode
  footer?: ReactNode
  maxHeight?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 bg-black/45 z-[100] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden
      />
      {/* 2026-06-24 R-sheet-frame-fit: 데스크탑에서 PhoneFrame (420×min(900,vh)) 과
          맞춰 sheet 도 420px 폭 + 폰 하단 정렬. 모바일은 풀폭 그대로 (md: 분기). */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed left-0 right-0 bottom-0 z-[101] bg-[#F8F4ED] rounded-t-3xl px-5 pt-3.5 shadow-[0_-8px_32px_rgba(0,0,0,0.18)] overflow-y-auto transition-transform duration-300",
          "md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[400px]",
          open ? "md:translate-y-0 translate-y-0" : "md:translate-y-[120%] translate-y-full",
        )}
        style={{
          maxHeight,
          paddingBottom: "calc(env(safe-area-inset-bottom, 16px) + 18px)",
          // 데스크탑 — 폰 프레임 (높이 min(900, vh-2rem)) 의 하단에 맞춤.
          // 모바일 — viewport 하단.
          bottom: "max(0px, calc((100dvh - min(900px, 100dvh - 2rem)) / 2 - 10px))",
        }}
      >
        <div className="w-[38px] h-1 bg-[#2D2B26]/20 rounded-full mx-auto mb-3" />
        {title && <h3 className="text-[15px] font-extrabold tracking-tight mb-1 text-[#2D2B26]">{title}</h3>}
        {desc && <div className="text-[11px] font-semibold text-[#7A746A] mb-3.5">{desc}</div>}
        {children}
        {footer && <div className="flex gap-2 mt-4">{footer}</div>}
      </div>
    </>
  )
}
