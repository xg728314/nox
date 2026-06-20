"use client"
import Link from "next/link"
import { useMemo, useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useHostesses } from "../../_hooks/useMobileData"
import { initialOf } from "../../_lib/format"
import { cn } from "../../_lib/cn"

type FilterKey = "all" | "working" | "waiting" | "rest"

export default function StaffListPage() {
  const { data, isLoading, error } = useHostesses()
  const [filter, setFilter] = useState<FilterKey>("all")
  const [q, setQ] = useState("")

  const all = data?.hostesses ?? []
  // 2026-06-12 R-phantom-immediate: 사전등록도 즉시 정식 식구가 됨 →
  //   pre_registrations 별도 섹션 표시 불필요. all 에 다 포함됨.
  const filtered = useMemo(() => {
    let list = all
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((h) => (h.hostess_name ?? "").toLowerCase().includes(needle))
    }
    return list
  }, [all, q])

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="내 스태프"
        subtitle={data?.role === "owner" ? "사장 권한" : data?.role === "manager" ? "실장" : undefined}
        backHref="/m"
        right={
          <Link
            href="/m/staff/new"
            aria-label="새 스태프 등록"
            className="w-9 h-9 rounded-full bg-[#2D2B26] text-white flex items-center justify-center no-underline text-[14px] font-bold"
          >
            +
          </Link>
        }
      />

      {/* 검색 + 필터 */}
      <div className="px-5 py-3 flex flex-col gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 검색"
          className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-2.5 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
        />
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {(
            [
              { k: "all", lbl: "전체", n: all.length },
              { k: "working", lbl: "일하는 중", n: 0 },
              { k: "waiting", lbl: "대기", n: 0 },
              { k: "rest", lbl: "휴식", n: 0 },
            ] as const
          ).map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilter(c.k)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold border transition-colors",
                filter === c.k ? "bg-[#2D2B26] text-white border-[#2D2B26]" : "bg-white text-[#7A746A] border-[#D8D2C8]",
              )}
            >
              {c.lbl} <span className="opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 리스트 */}
      <div className="px-5 pb-24">
        {isLoading && <SkelList />}
        {error && <Err msg="식구 목록을 불러올 수 없습니다" />}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] font-semibold py-10">
            {q ? "검색 결과 없음" : "등록된 식구가 없습니다"}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">
            {filtered.map((h, i) => (
              <Link
                key={h.membership_id}
                href={`/m/staff/${encodeURIComponent(h.membership_id)}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 no-underline text-[#2D2B26] active:bg-[#EFEBE3]",
                  i > 0 && "border-t border-[#D8D2C8]/40",
                )}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[16px] font-extrabold text-[#A87D45] shrink-0">
                  {initialOf(h.hostess_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-extrabold tracking-tight truncate">{h.hostess_name}</div>
                  <div className="text-[10px] font-semibold text-[#7A746A] truncate">
                    {h.status === "approved" ? "승인됨" : h.status} · {h.role}
                  </div>
                </div>
                <div className="text-[16px] text-[#D8D2C8]">›</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function SkelList() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-[#EFEBE3] animate-pulse" />
      ))}
    </div>
  )
}
function Err({ msg }: { msg: string }) {
  return <div className="text-center text-red-600 text-[12px] font-semibold py-6">{msg}</div>
}
