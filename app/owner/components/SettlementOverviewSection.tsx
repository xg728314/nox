"use client"

/**
 * SettlementOverviewSection — owner 페이지 정산 개요 (접힘/펼침).
 *
 * 2026-05-03: app/owner/page.tsx 분할.
 */

type SettlementOverview = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
}

export default function SettlementOverviewSection({
  overview,
  expandSettlement,
  onToggle,
  error,
}: {
  overview: SettlementOverview[]
  expandSettlement: boolean
  onToggle: () => void
  error: string
}) {
  const finalizedCount = overview.filter((o) => o.status === "finalized").length
  const draftCount = overview.filter((o) => o.status === "draft").length
  const noneCount = overview.filter((o) => !o.has_settlement).length

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">{expandSettlement ? "▼" : "▶"}</span>
          <span className="text-sm font-medium text-slate-300">정산 개요</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">총 {overview.length}명</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-300">확정 {finalizedCount}</span>
          <span className="text-slate-600">·</span>
          <span className="text-amber-300">대기 {draftCount}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">없음 {noneCount}</span>
        </div>
      </button>

      {expandSettlement && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <div className="text-xs text-slate-400">확정</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">{finalizedCount}</div>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3">
              <div className="text-xs text-slate-400">대기</div>
              <div className="mt-1 text-2xl font-semibold text-amber-300">{draftCount}</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-xs text-slate-400">없음</div>
              <div className="mt-1 text-2xl font-semibold text-slate-400">{noneCount}</div>
            </div>
          </div>

          {overview.length === 0 && !error && (
            <div className="text-center py-4">
              <p className="text-slate-500 text-sm">정산 데이터가 없습니다.</p>
            </div>
          )}

          {overview.length > 0 && (
            <div className="space-y-2">
              {overview.map((o) => (
                <div
                  key={o.hostess_id}
                  className="flex items-center justify-between py-2 border-t border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                        o.has_settlement
                          ? o.status === "finalized"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                      }`}
                    >
                      {o.has_settlement ? (o.status === "finalized" ? "✓" : "◷") : "−"}
                    </div>
                    <div>
                      <div className="text-sm">{o.hostess_name || o.hostess_id.slice(0, 8)}</div>
                      <div className="text-xs text-slate-500">
                        {o.has_settlement
                          ? o.status === "finalized"
                            ? "정산 확정"
                            : "정산 대기"
                          : "정산 없음"}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === "finalized"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : o.status === "draft"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                    }`}
                  >
                    {o.status === "finalized" ? "확정" : o.status === "draft" ? "대기" : "없음"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
