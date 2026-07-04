"use client"
import Link from "next/link"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"

/**
 * 플레이스 (파트너 서비스) — /m/place
 *   6개 카테고리 그리드 — 미드나잇 테라스 참고.
 */
type Category = {
  id: string
  slug: string
  name: string
  icon: string | null
  banner_url: string | null
  color_hex: string | null
  is_new: boolean
}

export default function PlacePage() {
  const { data, isLoading } = useApi<{ categories: Category[] }>(
    "/api/partners/categories",
    { ttl: 300_000 },
  )
  const categories = data?.categories ?? []

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="플레이스" backHref="/m/me" />

      <div className="px-4 pb-24">
        {/* 배너 */}
        <div className="bg-gradient-to-br from-purple-600/40 to-fuchsia-600/40 border border-purple-500/30 rounded-3xl px-5 py-6 mb-4">
          <div className="text-[11px] font-bold text-purple-200 tracking-wider">
            신규 카테고리
          </div>
          <div className="text-[18px] font-extrabold tracking-tight mt-1">
            NOX 플레이스 이용가이드 🎉
          </div>
          <div className="text-[11px] font-semibold text-white/70 mt-1.5">
            헤어부터 성형까지 · 파트너 혜택 확인
          </div>
        </div>

        {/* 검색 */}
        <input
          type="search"
          placeholder="🔍  검색어를 입력해주세요"
          className="w-full bg-white/5 border border-white/10 rounded-full px-4 py-3 text-[13px] outline-none placeholder:text-white/40 mb-4"
        />

        {isLoading && (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[1/1.2] rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {/* 6개 카테고리 그리드 */}
        <div className="grid grid-cols-3 gap-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/m/place/${c.slug}`}
              className="relative aspect-[1/1.2] rounded-2xl overflow-hidden no-underline text-white active:scale-95 transition-transform"
              style={{
                background: c.color_hex
                  ? `linear-gradient(135deg, ${c.color_hex}55, ${c.color_hex}22)`
                  : "rgba(255,255,255,0.05)",
                border: `1px solid ${c.color_hex ?? "rgba(255,255,255,0.1)"}55`,
              }}
            >
              {c.is_new && (
                <span className="absolute top-1.5 right-1.5 bg-pink-500 text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded-full">
                  NEW
                </span>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                <span className="text-[32px] leading-none">{c.icon}</span>
                <span className="text-[11px] font-extrabold text-center leading-tight px-1">
                  {c.name}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
