"use client"
import Link from "next/link"
import { useState } from "react"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"

/**
 * 채용정보 게시판 (버블알바 참고) — /m/jobs
 *   - 지역/직종 필터
 *   - 실시간 초이스톡 링크
 *   - 광고 카드 리스트
 */
type Ad = {
  id: string
  title: string
  category: string
  region_top: string | null
  region_sub: string | null
  tc_amount: number | null
  thumbnail_url: string | null
  view_count: number
  like_count: number
  is_pinned: boolean
  start_at: string | null
  created_at: string
}

const REGIONS = ["전체", "서울", "부산", "인천", "대구", "대전", "광주", "울산", "경기"]
const CATEGORIES = ["전체", "텐쩜오", "룸싸롱", "퍼블릭", "하이퍼블릭", "호스트", "기타"]

export default function JobsPage() {
  const [regionTop, setRegionTop] = useState("전체")
  const [category, setCategory] = useState("전체")
  const [q, setQ] = useState("")

  const p = new URLSearchParams()
  if (regionTop !== "전체") p.set("region_top", regionTop)
  if (category !== "전체") p.set("category", category)
  if (q.trim()) p.set("q", q.trim())
  const { data, isLoading } = useApi<{ ads: Ad[] }>(
    `/api/ads?${p.toString()}`,
    { ttl: 30_000 },
  )
  const ads = data?.ads ?? []

  return (
    <div className="flex flex-col min-h-full bg-[#f7f7fb]">
      <PageHeader title="채용정보" backHref="/m/me" />

      <div className="px-4 pb-24">
        {/* 필터 드롭다운 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Select
            label="지역"
            value={regionTop}
            options={REGIONS}
            onChange={setRegionTop}
          />
          <Select
            label="직종"
            value={category}
            options={CATEGORIES}
            onChange={setCategory}
          />
        </div>

        {/* 검색 */}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍  채용정보 검색"
          className="w-full bg-white border border-gray-200 rounded-full px-4 py-3 text-[13px] outline-none placeholder:text-gray-400 mb-3"
        />

        {/* 실시간 초이스톡 배너 */}
        <Link
          href="/m/talk"
          className="block bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 mb-3 flex items-center gap-3 no-underline text-gray-800"
        >
          <span className="text-[18px]">💬</span>
          <div className="flex-1 text-[13px] font-extrabold">실시간 초이스톡</div>
          <span className="text-[16px] text-gray-400">›</span>
        </Link>

        {/* 광고 등록 버튼 */}
        <Link
          href="/m/jobs/new"
          className="block bg-gradient-to-br from-orange-400 to-pink-400 text-white rounded-2xl px-4 py-3 mb-3 no-underline"
        >
          <div className="flex items-center gap-2">
            <span className="text-[16px]">📢</span>
            <div className="flex-1 text-[13px] font-extrabold">채용 광고 등록하기</div>
            <span className="text-[14px]">›</span>
          </div>
        </Link>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && ads.length === 0 && (
          <div className="text-center text-[12px] text-gray-400 py-10">
            등록된 광고가 없습니다
          </div>
        )}

        {/* 광고 카드 리스트 */}
        <div className="space-y-2">
          {ads.map((a) => (
            <Link
              key={a.id}
              href={`/m/jobs/${a.id}`}
              className="block bg-white border border-gray-100 rounded-2xl overflow-hidden no-underline text-gray-800 shadow-sm active:bg-gray-50"
            >
              <div className="flex gap-3 p-3">
                {a.thumbnail_url ? (
                  <img
                    src={a.thumbnail_url}
                    alt=""
                    className="w-20 h-20 object-cover rounded-xl shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-orange-200 to-pink-200 flex items-center justify-center text-[24px] shrink-0">
                    🍸
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {a.is_pinned && (
                      <span className="text-[8px] font-extrabold bg-orange-500 text-white px-1.5 py-0.5 rounded-full">
                        PIN
                      </span>
                    )}
                    <span className="text-[9px] font-bold text-orange-500">
                      {getDayCount(a.start_at ?? a.created_at)}일째 광고중
                    </span>
                  </div>
                  <div className="text-[13px] font-extrabold tracking-tight mt-1 line-clamp-2">
                    {a.title}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1.5">
                    티씨 {a.tc_amount ? `${a.tc_amount}만원` : "미정"}
                    {a.region_top ? ` · ${a.region_top}${a.region_sub ? " " + a.region_sub : ""}` : ""}
                    {" · "}
                    <span className="text-orange-500 font-bold">{a.category}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <TabBar />
    </div>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-white border border-gray-200 rounded-full pl-4 pr-9 py-3 text-[13px] font-bold outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {label} {o}
          </option>
        ))}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-[12px]">
        ▼
      </span>
    </div>
  )
}

function getDayCount(iso: string): number {
  const d = new Date(iso).getTime()
  return Math.max(1, Math.floor((Date.now() - d) / (24 * 60 * 60_000)))
}
