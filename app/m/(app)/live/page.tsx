"use client"
import { useState } from "react"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import Link from "next/link"

/**
 * 실시간현황 (매장 상태) — /m/live
 *   미드나잇테라스 실시간현황 참고.
 */
type Store = {
  id: string
  store_name: string
  store_code: string
  floor: number | null
  live_note: string | null
  is_24h: boolean
  event_text: string | null
  category_tags: string[]
  region_display: string | null
  badge: string | null
  entry_level: string | null
  updated_at: string | null
}

const REGIONS = [
  { slug: "all", label: "전체" },
  { slug: "gangnam", label: "강남" },
  { slug: "non_gangnam", label: "비강남" },
  { slug: "outside", label: "서울 외" },
  { slug: "job", label: "✨ 구인" },
]
const CATEGORIES = [
  { slug: "all", label: "전체" },
  { slug: "public", label: "퍼블릭" },
  { slug: "jjum-o", label: "쩜오" },
  { slug: "ten", label: "텐/일프로" },
  { slug: "host", label: "✨ 호스트" },
]

export default function LivePage() {
  const [region, setRegion] = useState("gangnam")
  const [category, setCategory] = useState("all")
  const [q, setQ] = useState("")

  const { data, isLoading, refresh } = useApi<{ stores: Store[] }>(
    `/api/live-status/stores?region=${region}&category=${category}`,
    { ttl: 15_000 },
  )
  const stores = (data?.stores ?? []).filter((s) =>
    q.trim() ? s.store_name.toLowerCase().includes(q.trim().toLowerCase()) : true,
  )

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="실시간 현황" backHref="/m/me" />

      <div className="px-4 pb-24">
        {/* 검색 */}
        <div className="relative mb-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색어를 입력하세요"
            className="w-full bg-white/5 border border-white/10 rounded-full pl-4 pr-12 py-2.5 text-[12px] outline-none placeholder:text-white/40"
          />
          <button
            type="button"
            onClick={() => refresh()}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-[14px]"
          >
            🔄
          </button>
        </div>

        {/* 지역 탭 */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
          {REGIONS.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => setRegion(r.slug)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold border ${
                region === r.slug
                  ? "bg-purple-500/30 border-purple-400 text-purple-100"
                  : "bg-white/5 border-white/10 text-white/70"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 종목 칩 */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setCategory(c.slug)}
              className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-extrabold border ${
                category === c.slug
                  ? "bg-purple-500 border-purple-500 text-white"
                  : "bg-transparent border-white/20 text-white/60"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 채용 게시판 링크 (상단 배너) */}
        <Link
          href="/m/jobs"
          className="block bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 border border-purple-500/30 rounded-2xl px-3 py-2.5 mb-3 no-underline text-white"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-extrabold">💼 채용정보 게시판</div>
              <div className="text-[9px] text-white/60 mt-0.5">
                지역·종목 별 업소 채용 · 티씨 조건 확인
              </div>
            </div>
            <span className="text-[16px]">›</span>
          </div>
        </Link>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && stores.length === 0 && (
          <div className="text-center text-[12px] text-white/40 py-10">
            해당 조건의 매장이 없습니다
          </div>
        )}

        {/* 매장 리스트 */}
        <div className="space-y-2">
          {stores.map((s) => (
            <div
              key={s.id}
              className="bg-white/5 border border-white/10 rounded-2xl px-3 py-3 flex items-center gap-3"
            >
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500/30 to-fuchsia-500/30 flex items-center justify-center text-[16px] font-extrabold shrink-0">
                {s.store_name.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-extrabold truncate">{s.store_name}</span>
                  {s.badge && (
                    <span className="text-[8px] font-extrabold bg-purple-500 text-white px-1.5 py-0.5 rounded-full">
                      {s.badge}
                    </span>
                  )}
                  {s.region_display && (
                    <span className="text-[9px] font-bold text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded">
                      {s.region_display}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-white/60 mt-1 line-clamp-2">
                  {s.live_note ?? (s.is_24h ? "24시 영업" : "정보 없음")}
                  {s.event_text ? ` · ${s.event_text}` : ""}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {s.entry_level && (
                    <span className="text-[9px] font-bold text-white/70 bg-white/10 px-2 py-0.5 rounded">
                      {s.entry_level}
                    </span>
                  )}
                  {s.updated_at && (
                    <span className="text-[8px] text-white/40">
                      {new Date(s.updated_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
