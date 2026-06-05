"use client"
import { useParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useHostesses } from "../../../_hooks/useMobileData"
import { initialOf } from "../../../_lib/format"

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>()
  const id = decodeURIComponent(params.id ?? "")
  const { data, isLoading } = useHostesses()

  const h = (data?.hostesses ?? []).find((x) => x.membership_id === id)

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title={h?.hostess_name ?? "스태프"} backHref="/m/staff" />

      <div className="px-5 pb-24">
        {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-10">로딩 중...</div>}
        {!isLoading && !h && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">해당 스태프를 찾을 수 없습니다</div>
        )}
        {h && (
          <>
            <div className="bg-white rounded-3xl p-5 mb-3 flex items-center gap-4 border border-[#D8D2C8]/60">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-[26px] font-extrabold flex items-center justify-center shrink-0">
                {initialOf(h.hostess_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-extrabold tracking-tight">{h.hostess_name}</div>
                <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                  {h.status === "approved" ? "✓ 승인됨" : h.status} · {h.role}
                </div>
                <div className="text-[10px] font-semibold text-[#7A746A] mt-0.5">
                  membership {h.membership_id.slice(0, 12)}…
                </div>
              </div>
            </div>

            <Section title="기본 정보">
              <Row k="원소속 매장" v={h.origin_store_uuid ? h.origin_store_uuid.slice(0, 12) + "…" : "본 매장"} />
              <Row k="담당 실장" v={h.manager_membership_id ? h.manager_membership_id.slice(0, 12) + "…" : "—"} />
              <Row k="역할" v={h.role} />
              <Row k="가입 상태" v={h.status} />
            </Section>

            <Section title="누적 정산 (이번 주)">
              <Row k="메이드 건수" v="—" />
              <Row k="총 매출" v="—" />
              <Row k="지급액" v="—" />
              <div className="text-[9px] text-[#7A746A] px-4 pt-1 pb-3">정산 상세는 다음 라운드에서 연결됩니다.</div>
            </Section>
          </>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider px-1 mb-1.5">{title}</div>
      <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">{children}</div>
    </div>
  )
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#D8D2C8]/40 last:border-b-0">
      <span className="text-[12px] font-bold text-[#7A746A]">{k}</span>
      <span className="text-[13px] font-extrabold text-[#2D2B26] truncate ml-3">{v}</span>
    </div>
  )
}
