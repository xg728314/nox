"use client"
import Link from "next/link"
import { cn } from "../_lib/cn"
import { fmtMoney, initialOf } from "../_lib/format"
import type { ServiceCategory } from "../_lib/tokens"

export type StaffCardProps = {
  membershipId: string
  name: string
  category?: ServiceCategory | "mixed"
  storeLabel?: string
  isMyStore?: boolean
  earnings?: number
  count?: number
  subInfo?: string
  status?: "working" | "waiting" | "rest" | "off"
  href?: string
}

export function StaffCard({
  membershipId: _mid,
  name,
  category = "P",
  storeLabel,
  isMyStore,
  earnings,
  count,
  subInfo,
  status = "working",
  href = "/m/staff",
}: StaffCardProps) {
  const isStatusCard = status !== "working"
  const topBg =
    status === "waiting"
      ? "bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8]"
      : status === "rest"
        ? "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]"
        : status === "off"
          ? "bg-[#EFEBE3]"
          : category === "S"
            ? "bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE]"
            : category === "H"
              ? "bg-gradient-to-br from-[#FEE2E2] to-[#FECACA]"
              : category === "mixed"
                ? "bg-gradient-to-br from-[#DBEAFE] to-[#FEE2E2]"
                : "bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5]"

  const statusDotColor =
    status === "waiting" ? "bg-[#C49B61]" : status === "rest" ? "bg-[#F59E0B]" : status === "off" ? "bg-[#94A3B8]" : "bg-green-500"

  return (
    <Link
      href={href}
      className={cn(
        "block bg-[#FFFCF6] rounded-2xl overflow-hidden shadow-[0_1px_6px_rgba(45,43,38,0.05)] transition-transform active:scale-[0.96]",
        status === "off" && "opacity-60",
      )}
    >
      <div className={cn("relative aspect-[1/0.95] p-[7px_5px] flex flex-col", topBg)}>
        <span
          className={cn("absolute top-[5px] left-[5px] w-[6px] h-[6px] rounded-full border-[1.5px] border-white", statusDotColor)}
        />
        {storeLabel && (
          <span
            className={cn(
              "absolute top-1 right-1 px-[5px] py-[1px] text-[8px] font-extrabold rounded-full backdrop-blur-sm shadow-sm max-w-[75%] truncate",
              isMyStore ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white" : "bg-white/95 text-[#2D2B26]",
            )}
          >
            {storeLabel}
          </span>
        )}
        <div className="mt-auto text-center text-[14px] font-extrabold tracking-[-0.04em] leading-none">{name}</div>
        {subInfo && <div className="text-center text-[7px] font-bold text-[#2D2B26]/60 mt-[2px] truncate px-[2px]">{subInfo}</div>}
      </div>
      <div className="px-[6px] py-[5px] pb-[6px]">
        <div className="flex items-baseline justify-between gap-[3px]">
          <div
            className={cn(
              "font-extrabold tracking-tight truncate",
              isStatusCard ? "text-[9px] text-[#A87D45]" : "text-[11px]",
            )}
          >
            {earnings != null ? fmtMoney(earnings) : isStatusCard ? "대기 중" : "—"}
          </div>
          {count != null && <div className="text-[8px] font-bold text-[#C49B61]">{count}건</div>}
        </div>
        <div className="text-[8px] font-semibold text-[#7A746A] mt-[2px] truncate">{initialOf(name)} · {subInfo ?? ""}</div>
      </div>
    </Link>
  )
}
