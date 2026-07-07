"use client"
import Link from "next/link"
import { useState } from "react"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"

type Guest = {
  id: string
  display_name: string
  phone: string | null
  tags: string[]
  visit_count: number
  last_visit_at: string | null
  is_blacklisted: boolean
}

export default function GuestsPage() {
  const [q, setQ] = useState("")
  const url = q.trim() ? `/api/guests?q=${encodeURIComponent(q.trim())}` : "/api/guests"
  const { data, isLoading } = useApi<{ guests: Guest[] }>(url, { ttl: 30_000 })
  const guests = data?.guests ?? []

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="손님 관리"
        subtitle="재방문 정보 · 태그 · 취향"
        backHref="/m/me"
        right={
          <Link
            href="/m/guests/new"
            className="text-[10px] font-extrabold bg-[#C49B61] text-white rounded-full px-3 py-1.5"
          >
            + 손님
          </Link>
        }
      />

      <div className="px-5 pb-24">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍  손님 이름 · 특징 · 전화번호"
          className="w-full bg-white border border-[#D8D2C8] rounded-full px-4 py-3 text-[13px] outline-none mb-3"
        />

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && guests.length === 0 && (
          <div className="text-center py-10 text-[12px] text-[#7A746A]">
            {q.trim() ? "검색 결과 없음" : "등록된 손님 없음"}
          </div>
        )}

        <div className="space-y-2">
          {guests.map((g) => (
            <Link
              key={g.id}
              href={`/m/guests/${g.id}`}
              className="block bg-white border border-[#D8D2C8]/60 rounded-2xl px-4 py-3 no-underline text-[#2D2B26] active:bg-[#FAF5EC]"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center text-[16px] font-extrabold shrink-0 ${
                    g.is_blacklisted
                      ? "bg-red-100 text-red-600"
                      : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white"
                  }`}
                >
                  {g.display_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-extrabold truncate">{g.display_name}</span>
                    {g.is_blacklisted && (
                      <span className="text-[8px] font-extrabold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                        블랙
                      </span>
                    )}
                  </div>
                  {g.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {g.tags.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] font-bold text-[#A87D45] bg-[#C49B61]/15 px-1.5 py-0.5 rounded"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[9px] text-[#7A746A] mt-1">
                    방문 {g.visit_count}회
                    {g.last_visit_at && ` · ${formatDate(g.last_visit_at)}`}
                    {g.phone && ` · ${g.phone}`}
                  </div>
                </div>
                <span className="text-[14px] text-[#D8D2C8]">›</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <TabBar />
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000))
  if (days === 0) return "오늘"
  if (days === 1) return "어제"
  if (days < 30) return `${days}일 전`
  return d.toLocaleDateString("ko-KR")
}
