"use client"
import Link from "next/link"
import { useApi } from "../_hooks/useApi"

/**
 * 이상 감지 배너. 홈 상단에 표시.
 *   - dispatch stuck / zombie session / imminent auto-close / inventory low / cron stale
 *   - 30초 polling. 0건이면 미표시.
 *   - critical = 빨강, warning = 주황, info = 파랑.
 *
 * R-ops-anomalies (2026-06-28).
 */
type Anomaly = {
  code: string
  severity: "critical" | "warning" | "info"
  count: number
  detail: string
  url?: string
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-300 text-red-800",
  warning: "bg-amber-50 border-amber-300 text-amber-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
}
const ICON: Record<string, string> = {
  imminent_auto_close: "⏰",
  dispatch_stuck: "📮",
  zombie_session: "🧟",
  inventory_low: "📦",
  cron_stale: "⚙️",
}

export function AnomaliesBanner() {
  const { data } = useApi<{ anomalies: Anomaly[] }>("/api/ops/anomalies", {
    ttl: 30_000,
  })
  const list = data?.anomalies ?? []
  if (list.length === 0) return null
  return (
    <div className="space-y-1.5 mb-2">
      {list.map((a) => {
        const style = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info
        const icon = ICON[a.code] ?? "⚠️"
        const inner = (
          <div
            className={`border-2 rounded-2xl px-3 py-2 flex items-center gap-2 ${style}`}
          >
            <span className="text-[16px] leading-none">{icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-extrabold leading-tight truncate">
                {a.detail}
              </div>
            </div>
            {a.url && (
              <span className="text-[10px] font-extrabold opacity-70 shrink-0">›</span>
            )}
          </div>
        )
        return a.url ? (
          <Link key={a.code} href={a.url} className="block">
            {inner}
          </Link>
        ) : (
          <div key={a.code}>{inner}</div>
        )
      })}
    </div>
  )
}
