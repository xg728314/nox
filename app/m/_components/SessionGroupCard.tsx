"use client"
import { cn } from "../_lib/cn"
import { getStoreColor } from "../_lib/storeColor"

/**
 * 같은 세션에서 함께 일하는 식구 (2명 이상) 를 하나의 컨테이너로 묶어 표시.
 *   R-session-group (2026-06-28): 사용자 요청 — "같은 방인지 다른 방인데
 *   같은 매장인지 시인성 좋게".
 *
 *   - 좌측 세로 스트라이프 = 매장 색 (라이브=파랑, 마블=빨강 등)
 *   - 상단 헤더 = 매장 · 방번호 · 종목 · 시작→종료
 *   - 안에 mini-card 로 각 식구 (이름 + status dot). 클릭 = onTapHostess.
 *   - grid col-span: 2명=2, 3명=3, 4명+=4 (최대 4열 grid 에 맞춤).
 *   - 임박 (남은 분 ≤ 10) 시 border 빨강 + pulse.
 */
export type SessionGroupMember = {
  membershipId: string
  name: string
}

export type SessionGroupCardProps = {
  sessionId: string
  storeName: string | null | undefined
  category: string | null | undefined
  /** 방번호 — 있으면 헤더에 표시 */
  roomNo?: string | null
  /** ISO — 시작 시각 (HH:MM 표기 + 종료시각 계산) */
  startedAt: string | null | undefined
  timeMinutes: number | null | undefined
  /** 남은 분 (모든 멤버 중 min). ≤10 이면 임박 */
  remainingMinutes: number | null | undefined
  members: SessionGroupMember[]
  onTapMember?: (membershipId: string) => void
  /** 선택 모드 — 선택된 membership ids */
  selectedIds?: Set<string>
}

export function SessionGroupCard({
  storeName,
  category,
  roomNo,
  startedAt,
  timeMinutes,
  remainingMinutes,
  members,
  onTapMember,
  selectedIds,
}: SessionGroupCardProps) {
  const color = getStoreColor(storeName)
  const isUrgent =
    typeof remainingMinutes === "number" && remainingMinutes > 0 && remainingMinutes <= 10
  const timeText = startedAt
    ? `${fmtClockTime(startedAt)} → ${fmtEndClockTime(startedAt, timeMinutes)}`
    : ""

  // grid col-span: 2명=2, 3명=3, 4+=4
  const span = Math.min(4, Math.max(2, members.length))
  const spanClass =
    span === 4 ? "col-span-4" : span === 3 ? "col-span-3" : "col-span-2"

  return (
    <div
      className={cn(
        "relative rounded-2xl overflow-hidden bg-[#FFFCF6] border-2 shadow-[0_1px_6px_rgba(45,43,38,0.06)]",
        spanClass,
        isUrgent && "animate-pulse",
      )}
      style={{
        borderColor: isUrgent ? "rgb(239 68 68)" : color.border,
      }}
    >
      {/* 좌측 세로 스트라이프 = 매장 색 */}
      <div
        className="absolute top-0 left-0 bottom-0 w-[4px]"
        style={{ background: color.stripe }}
      />

      {/* 상단 헤더 — 매장 · 방 · 종목 · 시간 */}
      <div
        className="pl-[8px] pr-[6px] py-[3px] flex items-center gap-1.5 border-b"
        style={{
          background: color.headerBg,
          borderColor: color.border,
        }}
      >
        <span
          className="text-[9px] font-extrabold leading-none truncate"
          style={{ color: color.headerText }}
        >
          {storeName ?? "?"}
        </span>
        {roomNo && (
          <span
            className="text-[8px] font-extrabold leading-none px-1 py-[1px] rounded-full bg-white/80"
            style={{ color: color.headerText }}
          >
            🚪 {roomNo}번
          </span>
        )}
        {category && (
          <span
            className="text-[8px] font-bold leading-none px-1 py-[1px] rounded-full bg-white/60"
            style={{ color: color.headerText }}
          >
            {category}
          </span>
        )}
        <span className="flex-1" />
        {timeText && (
          <span
            className={cn(
              "text-[8px] font-bold tabular-nums leading-none",
              isUrgent ? "text-red-600" : "text-[#2D2B26]/60",
            )}
          >
            {timeText}
          </span>
        )}
      </div>

      {/* 임박 카운트다운 (남은 분 표시) */}
      {isUrgent && typeof remainingMinutes === "number" && (
        <div className="text-center text-[13px] font-extrabold text-red-600 leading-none py-1 tabular-nums drop-shadow-[0_1px_2px_rgba(220,38,38,0.4)]">
          ⏰ {remainingMinutes}분
        </div>
      )}

      {/* 멤버 mini-card들 — 나란히 flex */}
      <div className="flex gap-1 p-[5px] pl-[8px]">
        {members.map((m) => {
          const selected = selectedIds?.has(m.membershipId) ?? false
          return (
            <button
              key={m.membershipId}
              type="button"
              onClick={() => onTapMember?.(m.membershipId)}
              className={cn(
                "flex-1 min-w-0 rounded-lg py-1.5 px-1 flex items-center justify-center gap-1 bg-white/70 active:scale-95 transition-transform",
                selected && "ring-2 ring-[#C49B61] bg-[#FAF5EC]",
              )}
            >
              <span className="w-[6px] h-[6px] rounded-full bg-green-500 border border-white shrink-0" />
              <span
                className={cn(
                  "text-[12px] font-extrabold tracking-tight leading-none truncate",
                  isUrgent && "text-red-700",
                )}
              >
                {m.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function fmtClockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function fmtEndClockTime(startIso: string, minutes: number | null | undefined): string {
  if (minutes == null) return ""
  const d = new Date(startIso)
  if (Number.isNaN(d.getTime())) return ""
  d.setMinutes(d.getMinutes() + minutes)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
