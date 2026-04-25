"use client"

/**
 * 공용 빈 상태 UI. 2026-04-25: "없습니다" 로 끝나는 막다른 길 제거 —
 *   사용자가 다음 할 일을 명확히 알 수 있도록 행동 유도 버튼 포함.
 *
 * 사용 예:
 *   <EmptyState
 *     icon="📭"
 *     title="등록된 스태프가 없습니다"
 *     description="먼저 스태프를 등록해야 매장 운영이 가능합니다."
 *     action={{ label: "스태프 등록하러 가기", onClick: () => router.push("/admin/members/create") }}
 *   />
 */

type EmptyStateProps = {
  icon?: string
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  secondary?: {
    label: string
    onClick: () => void
  }
  compact?: boolean
}

export default function EmptyState({
  icon = "📭",
  title,
  description,
  action,
  secondary,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] text-center ${
        compact ? "p-4" : "p-8"
      }`}
    >
      <div className={compact ? "text-2xl mb-1" : "text-4xl mb-3"}>{icon}</div>
      <div className={`font-semibold text-slate-200 ${compact ? "text-sm" : "text-base"}`}>
        {title}
      </div>
      {description && (
        <p className={`text-slate-500 leading-relaxed mx-auto max-w-sm ${compact ? "text-xs mt-1" : "text-sm mt-2"}`}>
          {description}
        </p>
      )}
      {(action || secondary) && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {action && (
            <button
              onClick={action.onClick}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold hover:bg-cyan-500/30"
            >
              {action.label} →
            </button>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 text-sm hover:bg-white/[0.06]"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
