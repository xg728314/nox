"use client"
import Link from "next/link"
import { useRef } from "react"
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
  /** 선택 모드 — true 면 체크 표시 + onTap 클릭만 (Link 비활성) */
  selected?: boolean
  /** 탭 핸들러. 지정하면 button 렌더 + href 무시. */
  onTap?: () => void
  /** 길게 눌러서 selection 모드 진입 */
  onLongPress?: () => void
  /** R-working-detail (2026-06-25): 일하는 식구의 세션 상세 표시 */
  workingDetail?: {
    storeName?: string | null
    category?: string | null
    remainingMinutes?: number | null
  }
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
  selected = false,
  onTap,
  onLongPress,
  workingDetail,
}: StaffCardProps) {
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

  // R-card-compact (2026-06-25): 카드 높이 절반. 하단 영역 제거, 상단만 사용.
  //   - aspect 1/0.55 (이전 1/0.95 + 하단 영역) → 약 ½ 높이
  //   - 일하는 식구: workingDetail 로 매장/종목/남은시간 표시 (subInfo 대체)
  const detailLine = status === "working" && workingDetail
    ? formatWorkingDetail(workingDetail)
    : subInfo
  const cardInner = (
    <div className={cn("relative aspect-[1/0.55] p-[6px_5px] flex flex-col rounded-2xl overflow-hidden", topBg)}>
      <span
        className={cn("absolute top-[5px] left-[5px] w-[6px] h-[6px] rounded-full border-[1.5px] border-white z-[2]", statusDotColor)}
      />
      {/* 선택 모드 체크 표시 */}
      {selected && (
        <span className="absolute inset-0 bg-gradient-to-br from-[#C49B61]/30 to-[#A87D45]/40 z-[1] flex items-center justify-center">
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white flex items-center justify-center text-[14px] font-extrabold shadow-lg">
            ✓
          </span>
        </span>
      )}
      {storeLabel && (
        <span
          className={cn(
            "absolute top-1 right-1 px-[5px] py-[1px] text-[8px] font-extrabold rounded-full backdrop-blur-sm shadow-sm max-w-[75%] truncate z-[2]",
            isMyStore ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white" : "bg-white/95 text-[#2D2B26]",
          )}
        >
          {storeLabel}
        </span>
      )}
      <div className="mt-auto text-center text-[13px] font-extrabold tracking-[-0.04em] leading-tight">{name || initialOf(name)}</div>
      {detailLine && (
        <div className="text-center text-[8px] font-bold text-[#2D2B26]/70 mt-[1px] truncate px-[2px] leading-tight">
          {detailLine}
        </div>
      )}
      {earnings != null && (
        <div className="text-center text-[9px] font-extrabold text-[#A87D45] mt-[1px] truncate">
          {fmtMoney(earnings)}{count != null && ` · ${count}건`}
        </div>
      )}
    </div>
  )

  const baseClass = cn(
    "block bg-[#FFFCF6] rounded-2xl overflow-hidden shadow-[0_1px_6px_rgba(45,43,38,0.05)] transition-transform active:scale-[0.96] text-left w-full",
    status === "off" && "opacity-60",
    selected && "ring-2 ring-[#C49B61] ring-offset-1",
  )

  if (onTap) {
    return <TappableCard baseClass={baseClass} onTap={onTap} onLongPress={onLongPress}>{cardInner}</TappableCard>
  }

  return (
    <Link href={href} className={baseClass}>
      {cardInner}
    </Link>
  )
}

/**
 * 길게 누르기 (600ms) 와 짧은 탭 을 구분하는 button.
 *   - longPress 발동 시 fired ref 가 true → 이후 click 무시.
 *   - mouse / touch 둘 다 지원.
 */
function TappableCard({
  baseClass,
  onTap,
  onLongPress,
  children,
}: {
  baseClass: string
  onTap: () => void
  onLongPress?: () => void
  children: React.ReactNode
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)

  const start = () => {
    firedRef.current = false
    if (!onLongPress) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      timerRef.current = null
      onLongPress()
    }, 600)
  }
  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const click = (e: React.MouseEvent) => {
    cancel()
    if (firedRef.current) {
      // long press 가 이미 발동 — onTap skip
      firedRef.current = false
      e.preventDefault()
      return
    }
    onTap()
  }
  return (
    <button
      type="button"
      onClick={click}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      className={baseClass}
    >
      {children}
    </button>
  )
}

/**
 * R-working-detail (2026-06-25): 일하는 식구 카드의 상세 라인 포맷.
 *   "라이브 · 셔츠 · 23분"  /  "마블 · 퍼블릭 · 곧 종료"
 */
function formatWorkingDetail(d: { storeName?: string | null; category?: string | null; remainingMinutes?: number | null }): string {
  const parts: string[] = []
  if (d.storeName) parts.push(d.storeName)
  if (d.category) parts.push(d.category)
  if (typeof d.remainingMinutes === "number") {
    if (d.remainingMinutes <= 0) parts.push("종료")
    else if (d.remainingMinutes <= 10) parts.push(`⏰ ${d.remainingMinutes}분`)
    else parts.push(`${d.remainingMinutes}분`)
  }
  return parts.join(" · ")
}
