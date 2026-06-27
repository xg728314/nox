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
    /** ISO timestamp — 시작시각 표기 (HH:MM) + 종료시각 계산 */
    startedAt?: string | null
    /** 종료시각 = startedAt + timeMinutes */
    timeMinutes?: number | null
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
  // R-urgent-bg (2026-06-26): 임박(≤10분) 시 배경을 빨간 톤으로 — 한눈에 띄도록.
  //   기존엔 ring 만 빨갰는데 "반짝" 효과가 약했음.
  const _isUrgentBg =
    status === "working" &&
    workingDetail?.remainingMinutes != null &&
    workingDetail.remainingMinutes > 0 &&
    workingDetail.remainingMinutes <= 10
  const topBg = _isUrgentBg
    ? "bg-gradient-to-br from-red-200 to-red-300"
    : status === "waiting"
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

  // R-card-v2 (2026-06-25): 정보 강조 layout.
  //   · aspect 1/0.75 — 시작/종료 시각 row 까지 여유 (이전 0.55 너무 빡빡)
  //   · vertical center — 이름 + 상세 라인 가운데 정렬 (이전 mt-auto 로 밑에 몰림)
  //   · detailLine 10px (이전 8px) — 매장·종목·남은시간 강조. 단일 줄 (truncate)
  //   · 시간 row 7px — 상단 가운데. \"21:00 → 22:30\"
  //   · 남은 분 ≤ 10 → 카드 전체 animate-pulse + 빨간 ring (반짝)
  const detailLine = status === "working" && workingDetail
    ? formatWorkingDetail(workingDetail)
    : subInfo
  const timeRow = status === "working" && workingDetail?.startedAt
    ? `${fmtClockTime(workingDetail.startedAt)} → ${fmtEndClockTime(workingDetail.startedAt, workingDetail.timeMinutes)}`
    : null
  const isUrgent =
    status === "working" &&
    workingDetail?.remainingMinutes != null &&
    workingDetail.remainingMinutes > 0 &&
    workingDetail.remainingMinutes <= 10
  const remaining = workingDetail?.remainingMinutes
  const cardInner = (
    <div className={cn("relative aspect-[1/0.75] p-[5px] flex flex-col rounded-2xl overflow-hidden", topBg)}>
      <span
        className={cn("absolute top-[4px] left-[4px] w-[6px] h-[6px] rounded-full border-[1.5px] border-white z-[2]", statusDotColor)}
      />
      {/* 선택 모드 체크 표시 */}
      {selected && (
        <span className="absolute inset-0 bg-gradient-to-br from-[#C49B61]/30 to-[#A87D45]/40 z-[3] flex items-center justify-center">
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white flex items-center justify-center text-[14px] font-extrabold shadow-lg">
            ✓
          </span>
        </span>
      )}
      {storeLabel && (
        <span
          className={cn(
            "absolute top-[3px] right-[3px] px-[5px] py-[1px] text-[7px] font-extrabold rounded-full backdrop-blur-sm shadow-sm max-w-[55%] truncate z-[2]",
            isMyStore ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white" : "bg-white/95 text-[#2D2B26]",
          )}
        >
          {storeLabel}
        </span>
      )}
      {/* R-urgent-countdown (2026-06-27): 임박(≤10분) 시 상단에 큰 카운트다운 + pulse.
          그 외엔 시작→종료 시간 표시. 사용자 요구: "10분 9분 빤짝" 직관적 카운트다운. */}
      {isUrgent && remaining != null ? (
        <div className="text-center text-[18px] font-extrabold text-red-600 leading-none mt-[2px] tabular-nums animate-pulse drop-shadow-[0_1px_2px_rgba(220,38,38,0.4)]">
          ⏰ {remaining}분
        </div>
      ) : timeRow ? (
        <div className="text-center text-[8px] font-bold text-[#2D2B26]/55 leading-none mt-[1px] tabular-nums">
          {timeRow}
        </div>
      ) : null}
      {/* 가운데 — 이름 + 상세 라인 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-[2px] min-w-0">
        <div className={cn(
          "text-[13px] font-extrabold tracking-[-0.04em] leading-none truncate max-w-full",
          isUrgent && "text-red-700",
        )}>
          {name || initialOf(name)}
        </div>
        {detailLine && (
          <div
            className={cn(
              "text-[10px] font-extrabold tracking-tight leading-none truncate max-w-full px-[2px]",
              isUrgent ? "text-red-600" : "text-[#2D2B26]/85",
            )}
          >
            {detailLine}
          </div>
        )}
      </div>
      {earnings != null && (
        <div className="text-center text-[9px] font-extrabold text-[#A87D45] truncate leading-none mb-[1px]">
          {fmtMoney(earnings)}{count != null && ` · ${count}건`}
        </div>
      )}
    </div>
  )

  const baseClass = cn(
    "block bg-[#FFFCF6] rounded-2xl overflow-hidden shadow-[0_1px_6px_rgba(45,43,38,0.05)] transition-transform active:scale-[0.96] text-left w-full",
    status === "off" && "opacity-60",
    selected && "ring-2 ring-[#C49B61] ring-offset-1",
    // 종료 임박 — 빨간 ring + animate-pulse (반짝). selected ring 보다 우선 안 함 (selected 우선).
    isUrgent && !selected && "ring-2 ring-red-500 animate-pulse",
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
 *   단일 줄 truncate 전제 — 짧고 의미있게.
 */
function formatWorkingDetail(d: { storeName?: string | null; category?: string | null; remainingMinutes?: number | null }): string {
  const parts: string[] = []
  if (d.storeName) parts.push(d.storeName)
  if (d.category) parts.push(d.category)
  if (typeof d.remainingMinutes === "number") {
    if (d.remainingMinutes <= 0) parts.push("종료")
    else parts.push(`${d.remainingMinutes}분`)
  }
  return parts.join(" · ")
}

/** HH:MM 표기 (ISO timestamp) */
function fmtClockTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
/** start + minutes 의 종료 HH:MM */
function fmtEndClockTime(startIso: string | null | undefined, minutes: number | null | undefined): string {
  if (!startIso || minutes == null) return ""
  const d = new Date(startIso)
  if (Number.isNaN(d.getTime())) return ""
  d.setMinutes(d.getMinutes() + minutes)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
