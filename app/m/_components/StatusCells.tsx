"use client"
import { cn } from "../_lib/cn"

export type StatusCellsProps = {
  working: number
  waiting: number
  /** R-status-cells-v2 (2026-06-25): 휴식 → 총인원 변경. 클릭 시 출근 모드 진입. */
  total: number
  active?: "working" | "waiting" | "total" | null
  onClick?: (status: "working" | "waiting" | "total") => void
  /** R-ending-soon (2026-06-25): 10분 이내 종료 임박 식구 수. > 0 면 일하는중 라벨 옆에 표시. */
  endingSoonCount?: number
}

export function StatusCells({ working, waiting, total, active, onClick, endingSoonCount = 0 }: StatusCellsProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {(
        [
          { key: "working", num: working, lbl: "일하는 중", bg: "bg-green-500/10 border-green-500/25", text: "text-green-700" },
          { key: "waiting", num: waiting, lbl: "대기", bg: "bg-[#C49B61]/10 border-[#C49B61]/25", text: "text-[#A87D45]" },
          { key: "total", num: total, lbl: "총인원 (출근)", bg: "bg-blue-500/10 border-blue-500/25", text: "text-blue-700" },
        ] as const
      ).map((c) => {
        const isActive = active === c.key
        const showSoon = c.key === "working" && endingSoonCount > 0
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onClick?.(c.key)}
            className={cn(
              "rounded-xl py-2 px-1 text-center border transition-transform active:scale-[0.94] relative",
              c.bg,
              isActive && "ring-2 ring-current ring-offset-1",
            )}
          >
            <div className={cn("text-[18px] font-extrabold tracking-tight leading-none", c.text)}>{c.num}</div>
            <div className={cn("text-[9px] font-bold mt-[3px] tracking-tight", c.text)}>{c.lbl}</div>
            {showSoon && (
              <div className="text-[8px] font-extrabold text-red-600 mt-0.5">
                ⏰ 10분전 {endingSoonCount}명
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
