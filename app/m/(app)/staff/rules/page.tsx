"use client"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"

const RULES = [
  { title: "지각", penalty: "5,000원", desc: "정해진 출근 시간 30분 이상 지각" },
  { title: "결근 (무단)", penalty: "30,000원", desc: "미리 알리지 않은 결근" },
  { title: "조퇴", penalty: "10,000원", desc: "사전 협의 없이 정상 시간 전 퇴근" },
  { title: "복장 위반", penalty: "5,000원", desc: "정해진 드레스코드 미준수" },
  { title: "휴대폰 사용", penalty: "3,000원", desc: "테이블 중 휴대폰 사용 적발" },
]

export default function StaffRulesPage() {
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="스태프 규칙 / 페널티" backHref="/m/staff" />
      <div className="px-5 pb-24 flex flex-col gap-3">
        <div className="text-[11px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          매장별로 페널티 금액이 다를 수 있습니다. 사장이 매장 설정에서 조정.
        </div>
        <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden">
          {RULES.map((r, i) => (
            <div key={r.title} className={`px-4 py-3 ${i > 0 ? "border-t border-[#D8D2C8]/40" : ""}`}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="text-[13px] font-extrabold tracking-tight">{r.title}</div>
                <div className="text-[12px] font-extrabold text-red-600">{r.penalty}</div>
              </div>
              <div className="text-[10px] font-semibold text-[#7A746A]">{r.desc}</div>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-[#7A746A] text-center font-semibold mt-2">
          ⓘ 실제 페널티 적용은 매장 설정 + 정산 단계에서 처리됩니다
        </div>
      </div>
      <TabBar />
    </div>
  )
}
