"use client"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useApi } from "../../../_hooks/useApi"
import { fmtMoneyWon } from "../../../_lib/format"

type CrossStoreSettlement = {
  business_date: string
  rows: Array<{
    store_uuid: string
    store_name: string
    direction: "in" | "out"
    count: number
    gross: number
  }>
}

export default function StoreSettlementPage() {
  const params = useSearchParams()
  const storeFilter = params?.get("store") ?? null
  const { data, isLoading, error } = useApi<CrossStoreSettlement>("/api/cross-store/settlement")
  const rows = (data?.rows ?? []).filter((r) => (storeFilter ? r.store_name === storeFilter : true))

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="매장간 정산" subtitle={data?.business_date} backHref="/m/settle" />
      <div className="px-5 pb-24">
        {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-8">로딩 중...</div>}
        {error && <div className="text-center text-[12px] text-red-600 py-8">정산을 불러올 수 없습니다</div>}
        {!isLoading && rows.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] py-8">해당 기간 정산 내역 없음</div>
        )}
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div
              key={`${r.store_uuid}-${i}`}
              className={`bg-white rounded-2xl border ${r.direction === "in" ? "border-green-500/30" : "border-red-500/30"} px-4 py-3 flex items-center gap-3`}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-extrabold ${r.direction === "in" ? "bg-green-500/15 text-green-700" : "bg-red-500/12 text-red-700"}`}
              >
                {r.direction === "in" ? "←" : "→"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-extrabold tracking-tight">{r.store_name}</div>
                <div className="text-[10px] font-semibold text-[#7A746A]">{r.count}건</div>
              </div>
              <div className={`text-[15px] font-extrabold ${r.direction === "in" ? "text-green-700" : "text-red-700"}`}>
                {r.direction === "in" ? "+" : "-"}
                {fmtMoneyWon(r.gross)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TabBar />
    </div>
  )
}
