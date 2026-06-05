"use client"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useServiceTypes, useMe } from "../../../_hooks/useMobileData"

export default function StoreSettingsPage() {
  const me = useMe()
  const types = useServiceTypes()
  const list = types.data?.service_types ?? []
  const grouped = new Map<string, typeof list>()
  for (const t of list) {
    if (!grouped.has(t.service_type)) grouped.set(t.service_type, [])
    grouped.get(t.service_type)!.push(t)
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="매장 설정"
        subtitle={me.data?.store_name ?? ""}
        backHref="/m/store"
      />
      <div className="px-5 pb-24 flex flex-col gap-4">
        <div className="text-[11px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          영업일 진행 중에는 단가를 수정할 수 없습니다. 사장만 편집 가능.
        </div>

        {types.isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
        {types.data && list.length === 0 && (
          <div className="text-center text-[12px] text-red-600 py-6">⚠ 종목 단가가 설정되지 않았습니다 — 체크인 불가</div>
        )}

        {Array.from(grouped.entries()).map(([cat, rows]) => (
          <div key={cat} className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden">
            <div className="px-4 pt-3 pb-1 text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider">{cat}</div>
            {rows
              .sort((a, b) => b.time_minutes - a.time_minutes)
              .map((r, i) => (
                <div
                  key={`${cat}-${r.time_type}-${i}`}
                  className={`flex items-center px-4 py-3 ${i > 0 ? "border-t border-[#D8D2C8]/40" : ""}`}
                >
                  <div className="flex-1">
                    <div className="text-[13px] font-extrabold tracking-tight">{r.time_type}</div>
                    <div className="text-[10px] font-semibold text-[#7A746A]">
                      {r.time_minutes}분{r.has_greeting_check ? " · 인사확인" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-extrabold">{Math.round(r.price / 10000).toLocaleString()}만원</div>
                    <div className="text-[9px] font-semibold text-[#A87D45]">
                      실장 차감 {Math.round(r.manager_deduction / 10000)}만
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
      <TabBar />
    </div>
  )
}
