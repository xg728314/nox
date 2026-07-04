"use client"
import { use } from "react"
import { useApi } from "../../../_hooks/useApi"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"

type Partner = {
  id: string
  name: string
  description: string | null
  address: string | null
  region_top: string | null
  region_sub: string | null
  phone: string | null
  thumbnail_url: string | null
  discount_percent: number | null
  special_offer: string | null
  tags: string[] | null
  is_featured: boolean
  is_new: boolean
  view_count: number
  like_count: number
}

const CATEGORY_LABELS: Record<string, string> = {
  hair: "헤어·메이크업",
  cosmetic: "성형·시술",
  fashion: "홀복·패션",
  nail: "라이프 스타일",
  event: "이벤트 & 혜택",
  review: "자유 톡 · 리뷰",
}

export default function PlaceCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = use(params)
  const { data, isLoading } = useApi<{ partners: Partner[] }>(
    `/api/partners?category=${slug}`,
    { ttl: 60_000 },
  )
  const partners = data?.partners ?? []

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title={CATEGORY_LABELS[slug] ?? "카테고리"} backHref="/m/place" />

      <div className="px-4 pb-24">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && partners.length === 0 && (
          <div className="text-center py-16 text-white/40">
            <div className="text-[40px] mb-3">🌱</div>
            <div className="text-[13px]">아직 등록된 파트너가 없습니다</div>
            <div className="text-[10px] mt-1 text-white/30">
              오픈 준비 중
            </div>
          </div>
        )}

        <div className="space-y-2">
          {partners.map((p) => (
            <div
              key={p.id}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
            >
              <div className="flex gap-3 p-3">
                {p.thumbnail_url ? (
                  <img
                    src={p.thumbnail_url}
                    alt=""
                    className="w-20 h-20 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-purple-500/30 to-fuchsia-500/30 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.is_new && (
                      <span className="text-[8px] font-extrabold bg-pink-500 text-white px-1.5 py-0.5 rounded-full">
                        NEW
                      </span>
                    )}
                    {p.is_featured && (
                      <span className="text-[8px] font-extrabold bg-yellow-500 text-white px-1.5 py-0.5 rounded-full">
                        ⭐
                      </span>
                    )}
                    <span className="text-[13px] font-extrabold truncate">{p.name}</span>
                  </div>
                  {p.description && (
                    <div className="text-[10px] text-white/60 mt-1 line-clamp-2">
                      {p.description}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    {p.discount_percent && (
                      <span className="text-[10px] font-extrabold text-orange-300 bg-orange-500/20 px-2 py-0.5 rounded-full">
                        {p.discount_percent}% 할인
                      </span>
                    )}
                    {p.region_sub && (
                      <span className="text-[9px] font-bold text-white/50">
                        {p.region_sub}
                      </span>
                    )}
                  </div>
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
