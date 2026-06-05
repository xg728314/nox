"use client"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"

export default function StaffNewPage() {
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="새 스태프 등록" backHref="/m/staff" />
      <div className="px-5 pb-24 flex-1 flex flex-col items-center justify-center text-center gap-2">
        <div className="text-[42px]">🚧</div>
        <div className="text-[14px] font-extrabold">다음 라운드 구현 예정</div>
        <div className="text-[11px] font-semibold text-[#7A746A] max-w-xs">
          새 식구 초대는 본인 매장 사장이 승인하는 흐름 (signup + approve) 필요.
          현재는 데스크탑 /signup → /admin/approvals 으로 처리하세요.
        </div>
      </div>
      <TabBar />
    </div>
  )
}
