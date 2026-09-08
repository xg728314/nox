"use client"
/**
 * /m/settle/store — 매장간 정산 (원소속 매장 관점 · 우리 아가씨가 타 매장에서 일한 내역)
 *
 * R40 (2026-09-09): 이전엔 응답 shape (rows) 불일치로 항상 empty · dead page.
 *   실제 API 는 { records: [{hostess_name, working_store_name, price_amount, hostess_payout}], summary: { total_payout, count } }
 *   이제 records 소비 · 워킹매장별 그룹핑 표시.
 */
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useApi } from "../../../_hooks/useApi"
import { fmtMoneyWon } from "../../../_lib/format"

type CrossStoreRecord = {
  participant_id: string
  session_id: string
  membership_id: string
  hostess_name: string | null
  category: string | null
  time_minutes: number | null
  price_amount: number | null
  hostess_payout: number | null
  working_store_uuid: string | null
  working_store_name: string | null
}

type CrossStoreResponse = {
  origin_store_uuid: string
  business_date: string
  records: CrossStoreRecord[]
  summary: { total_payout: number; count: number }
}

export default function StoreSettlementPage() {
  const params = useSearchParams()
  const storeFilter = params?.get("store") ?? null
  const { data, isLoading, error } = useApi<CrossStoreResponse>("/api/cross-store/settlement")
  const records = data?.records ?? []
  const filtered = storeFilter
    ? records.filter((r) => r.working_store_name === storeFilter)
    : records

  // 워킹매장별 그룹핑 (매장 → { count, gross, records })
  const grouped = useMemo(() => {
    const m = new Map<string, { store_name: string; count: number; gross: number; payout: number; records: CrossStoreRecord[] }>()
    for (const r of filtered) {
      const key = r.working_store_uuid ?? "unknown"
      const cur = m.get(key) ?? { store_name: r.working_store_name ?? "?", count: 0, gross: 0, payout: 0, records: [] }
      cur.count += 1
      cur.gross += toNum(r.price_amount)
      cur.payout += toNum(r.hostess_payout)
      cur.records.push(r)
      m.set(key, cur)
    }
    return Array.from(m.entries()).map(([uuid, v]) => ({ uuid, ...v }))
      .sort((a, b) => b.gross - a.gross)
  }, [filtered])

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="매장간 정산" subtitle={data?.business_date} backHref="/m/settle" />
      <div className="px-5 pb-24">
        {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-8">로딩 중...</div>}
        {error && <div className="text-center text-[12px] text-red-600 py-8">정산을 불러올 수 없습니다</div>}

        {/* 총액 카드 */}
        {!isLoading && data && (
          <div className="rounded-2xl bg-[#2D2B26] text-white p-4 mb-3">
            <div className="text-[10px] font-bold text-white/60 uppercase tracking-wider">
              우리 매장 아가씨 타 매장 매출
            </div>
            <div className="text-[22px] font-black mt-1">
              {fmtMoneyWon(records.reduce((s, r) => s + toNum(r.price_amount), 0))}
            </div>
            <div className="text-[11px] font-bold text-white/70 mt-1">
              {records.length}건 · 아가씨 지급 합계 {fmtMoneyWon(data.summary?.total_payout ?? 0)}
            </div>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-white/60 p-8 text-center">
            <div className="text-[36px] mb-1">📭</div>
            <div className="text-[13px] font-extrabold text-[#2D2B26]">해당 기간 매장간 정산 없음</div>
            <div className="text-[10px] font-bold text-[#7A746A] mt-1">
              우리 매장 아가씨가 타 매장에서 일한 기록이 없어요.
            </div>
          </div>
        )}

        {/* 매장별 그룹 */}
        <div className="flex flex-col gap-3">
          {grouped.map((g) => (
            <div key={g.uuid} className="rounded-2xl bg-white border border-green-500/30 overflow-hidden">
              <div className="px-4 py-3 bg-green-50 border-b border-green-500/20 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-extrabold text-green-900">{g.store_name}</div>
                  <div className="text-[10px] font-bold text-green-800">{g.count}건 · 지급 {fmtMoneyWon(g.payout)}</div>
                </div>
                <div className="text-[16px] font-black text-green-700">
                  +{fmtMoneyWon(g.gross)}
                </div>
              </div>
              <div className="divide-y divide-[#EDE7DA]">
                {g.records.map((r) => (
                  <div key={r.participant_id} className="px-4 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-extrabold text-[#2D2B26]">
                        {r.hostess_name ?? "?"}
                        {r.category && <span className="ml-1 text-[10px] font-bold text-[#7A746A]">· {r.category}</span>}
                        {r.time_minutes && <span className="ml-1 text-[10px] font-bold text-[#7A746A]">· {r.time_minutes}분</span>}
                      </div>
                      <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
                        지급 {fmtMoneyWon(toNum(r.hostess_payout))}
                      </div>
                    </div>
                    <div className="text-[13px] font-extrabold text-[#8C6A3A]">
                      {fmtMoneyWon(toNum(r.price_amount))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TabBar />
    </div>
  )
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
