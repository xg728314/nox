"use client"
import Link from "next/link"
import { useApi } from "../../../_hooks/useApi"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"

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
  contact_click_count: number
  status: string
  start_at: string | null
  end_at: string | null
  created_at: string
}

export default function MyAdsPage() {
  const { data, isLoading } = useApi<{ ads: Ad[] }>("/api/ads/mine", { ttl: 30_000 })
  const ads = data?.ads ?? []
  const active = ads.filter((a) => a.status === "active")

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="광고 관리" backHref="/m/me" />

      <div className="px-5 pb-24">
        {/* 요약 카드 */}
        <div className="bg-gradient-to-br from-orange-100 to-pink-100 rounded-3xl p-5 mb-4">
          <div className="text-[10px] font-extrabold text-orange-700 uppercase tracking-widest">
            내 광고
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-[32px] font-extrabold text-orange-700">{active.length}</span>
            <span className="text-[12px] font-bold text-gray-600">활성 광고</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-orange-300/50">
            <Stat label="조회수" value={ads.reduce((s, a) => s + a.view_count, 0)} />
            <Stat label="좋아요" value={ads.reduce((s, a) => s + a.like_count, 0)} />
            <Stat label="연락" value={ads.reduce((s, a) => s + a.contact_click_count, 0)} />
          </div>
        </div>

        <Link
          href="/m/jobs/new"
          className="block w-full bg-gradient-to-br from-orange-500 to-pink-500 text-white text-center py-3 rounded-2xl font-extrabold text-[13px] mb-4 no-underline"
        >
          + 새 광고 등록
        </Link>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && ads.length === 0 && (
          <div className="text-center text-[12px] text-gray-400 py-8">
            등록한 광고가 없습니다
          </div>
        )}

        {ads.map((a) => (
          <Link
            key={a.id}
            href={`/m/jobs/${a.id}`}
            className="block bg-white border border-gray-100 rounded-2xl p-3 mb-2 no-underline text-gray-800 shadow-sm"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                  a.status === "active"
                    ? "bg-green-100 text-green-700"
                    : a.status === "paused"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {a.status === "active" ? "활성" : a.status === "paused" ? "일시중지" : "만료"}
              </span>
              <span className="text-[10px] text-orange-600 font-bold">{a.category}</span>
            </div>
            <div className="text-[13px] font-extrabold mt-1 line-clamp-1">{a.title}</div>
            <div className="text-[10px] text-gray-500 mt-1">
              👁 {a.view_count} · ♡ {a.like_count} · 📞 {a.contact_click_count}
            </div>
          </Link>
        ))}
      </div>

      <TabBar />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[16px] font-extrabold text-gray-800">{value}</div>
      <div className="text-[9px] font-bold text-gray-500 uppercase mt-0.5">{label}</div>
    </div>
  )
}
