"use client"

/**
 * /super-admin/visualize — visualize layer entry.
 *
 * Read-only operations cockpit. Phase 1 ships money flow (sankey).
 * Future phases: entity graph, timeline, audit feed, health.
 */

import Link from "next/link"

export default function VisualizeIndexPage() {
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-100">관제 시각화</h1>
        <p className="text-sm text-slate-400">
          DB 저장값 기준의 read-only 관제 화면. 모든 카드는 stored value 만 표시하며
          정산/영수증/지급 로직을 재계산하지 않는다.
        </p>
      </header>

      <section className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/super-admin/visualize/money"
          className="rounded border border-slate-700 bg-slate-900 hover:border-slate-500 p-4 block"
        >
          <div className="text-sm font-medium text-slate-100">자금 흐름 (Sankey)</div>
          <div className="mt-1 text-xs text-slate-400">
            매장 + 영업일 단위. 매출 → 영수증 → 분배 → 지급 흐름.<br/>
            <span className="text-slate-500">stored sankey · as_of 기준</span>
          </div>
          <div className="mt-3 inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
            Phase 1
          </div>
        </Link>

        <Link
          href="/super-admin/visualize/network"
          className="rounded border border-slate-700 bg-slate-900 hover:border-slate-500 p-4 block"
        >
          <div className="text-sm font-medium text-slate-100">Jarvis 네트워크 맵</div>
          <div className="mt-1 text-xs text-slate-400">
            매장 · 실장 · 아가씨 · 세션 · 정산 · 지급 · 감사 노드. 2D force graph.<br/>
            <span className="text-slate-500">stored relations · 시간 범위 토글 · PII 마스킹</span>
          </div>
          <div className="mt-3 inline-block text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
            Phase 2.1
          </div>
        </Link>

        <div className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 opacity-60">
          <div className="text-sm font-medium text-slate-300">시간축 Timeline</div>
          <div className="mt-1 text-xs text-slate-500">
            세션/영업일 lifecycle. participants · orders · receipts · audit.
          </div>
          <div className="mt-3 inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">
            Phase 2
          </div>
        </div>

        <div className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 opacity-60">
          <div className="text-sm font-medium text-slate-300">Audit Feed</div>
          <div className="mt-1 text-xs text-slate-500">
            audit_events 90일 hot 윈도우. action 별 필터.
          </div>
          <div className="mt-3 inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">
            Phase 2
          </div>
        </div>
      </section>
    </main>
  )
}
