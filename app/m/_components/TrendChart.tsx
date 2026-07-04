"use client"
import { useApi } from "../_hooks/useApi"
import { fmtMoney } from "../_lib/format"

/**
 * 매출 트렌드 mini line chart (14일).
 *   - SVG 로 직접 그림 (라이브러리 X).
 *   - 오늘/최고/최저 tick 표시.
 *   - 클릭 시 상세 (없으면 그대로).
 *
 * R-trends (2026-06-28).
 */
type Day = {
  business_date: string
  total_gross: number
  tc_count: number
  participants: number
}

export function TrendChart({ days = 14 }: { days?: number }) {
  const { data, isLoading } = useApi<{ days: Day[] }>(
    `/api/reports/trends?days=${days}`,
    { ttl: 60_000 },
  )
  const rows = data?.days ?? []

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 p-4 mb-4 h-32 animate-pulse" />
    )
  }
  if (rows.length === 0) return null

  const W = 300
  const H = 80
  const PADDING = 8
  const values = rows.map((r) => r.total_gross)
  const maxV = Math.max(...values, 1)
  const minV = Math.min(...values, 0)
  const range = Math.max(1, maxV - minV)
  const stepX = (W - PADDING * 2) / Math.max(1, rows.length - 1)

  const points = rows.map((r, i) => {
    const x = PADDING + i * stepX
    const y = PADDING + (1 - (r.total_gross - minV) / range) * (H - PADDING * 2)
    return { x, y, r }
  })
  const pathD = points
    .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    .join(" ")
  const areaD =
    pathD +
    ` L${points[points.length - 1].x},${H - PADDING} L${points[0].x},${H - PADDING} Z`

  const today = rows[rows.length - 1]
  const yesterday = rows.length > 1 ? rows[rows.length - 2] : null
  const change = yesterday
    ? today.total_gross - yesterday.total_gross
    : 0
  const changePct =
    yesterday && yesterday.total_gross > 0
      ? Math.round((change / yesterday.total_gross) * 100)
      : 0
  const total = rows.reduce((a, r) => a + r.total_gross, 0)
  const avg = total / Math.max(1, rows.length)

  return (
    <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[11px] font-extrabold text-[#2D2B26]">
            📈 매출 트렌드 · 최근 {days}일
          </div>
          <div className="text-[9px] font-semibold text-[#7A746A] mt-0.5">
            평균 {fmtMoney(avg)} · 총 {fmtMoney(total)}
          </div>
        </div>
        {yesterday && (
          <div
            className={`text-[10px] font-extrabold ${
              change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-[#7A746A]"
            }`}
          >
            어제比 {change > 0 ? "+" : ""}
            {changePct}%
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-20"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#C49B61" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#C49B61" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#trend-fill)" />
        <path
          d={pathD}
          fill="none"
          stroke="#A87D45"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 3 : 1.5}
            fill={i === points.length - 1 ? "#A87D45" : "#C49B61"}
          />
        ))}
      </svg>
      <div className="flex justify-between mt-1 text-[8px] font-bold text-[#7A746A]">
        <span>{rows[0].business_date.slice(5)}</span>
        <span>{rows[rows.length - 1].business_date.slice(5)}</span>
      </div>
    </div>
  )
}
