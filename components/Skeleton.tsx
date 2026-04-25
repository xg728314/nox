/**
 * 공용 skeleton loader. 2026-04-25: "로딩 중..." 텍스트 대신 화면 윤곽을
 *   미리 그려서 CLS (Content Layout Shift) 와 깜빡임 감소.
 *
 * 사용 예:
 *   {loading ? <SkeletonList count={5} /> : <ActualList items={...} />}
 */

export function SkeletonLine({ width = "100%", height = 14 }: { width?: string; height?: number }) {
  return (
    <div
      className="animate-pulse rounded bg-white/[0.06]"
      style={{ width, height }}
    />
  )
}

export function SkeletonCard({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} width={i === 0 ? "60%" : "80%"} height={i === 0 ? 14 : 10} />
      ))}
    </div>
  )
}

export function SkeletonList({ count = 5, rows = 2 }: { count?: number; rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} rows={rows} />
      ))}
    </div>
  )
}

export function SkeletonStatCard() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
      <SkeletonLine width="40%" height={10} />
      <SkeletonLine width="70%" height={24} />
    </div>
  )
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  )
}
