"use client"
import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

type Ad = {
  id: string
  advertiser_user_id: string
  title: string
  body: string | null
  category: string
  region_top: string | null
  region_sub: string | null
  region_detail: string | null
  tc_amount: number | null
  thumbnail_url: string | null
  image_urls: string[] | null
  contact_phone: string | null
  contact_kakao: string | null
  view_count: number
  like_count: number
  start_at: string | null
  end_at: string | null
  created_at: string
}

type Advertiser = {
  business_name: string | null
  business_owner: string | null
  business_address: string | null
  business_address_detail: string | null
}

export default function AdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const toast = useToast()
  const [ad, setAd] = useState<Ad | null>(null)
  const [advertiser, setAdvertiser] = useState<Advertiser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch(`/api/ads/${id}`)
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          setAd(j.ad)
          setAdvertiser(j.advertiser ?? null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function startTalk() {
    try {
      const r = await apiFetch("/api/choice-talk/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_id: id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message ?? "실패")
      router.push(`/m/talk/${j.id}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    }
  }

  if (loading) {
    return (
      <div className="p-6 bg-white min-h-screen">
        <div className="h-6 rounded bg-gray-100 animate-pulse w-1/2" />
        <div className="h-48 rounded-2xl bg-gray-100 animate-pulse mt-4" />
      </div>
    )
  }
  if (!ad) {
    return (
      <div className="p-6 text-center text-gray-500">
        광고를 찾을 수 없습니다
      </div>
    )
  }

  const dayCount = Math.floor(
    (Date.now() - new Date(ad.start_at ?? ad.created_at).getTime()) / (24 * 60 * 60_000),
  )
  const endDate = ad.end_at ? new Date(ad.end_at) : null
  const remainDays = endDate
    ? Math.max(0, Math.floor((endDate.getTime() - Date.now()) / (24 * 60 * 60_000)))
    : null

  return (
    <div className="flex flex-col min-h-full bg-white pb-24">
      <PageHeader
        title=""
        backHref="/m/jobs"
        right={
          <div className="text-[11px] font-bold text-orange-500">
            {dayCount}일째 광고중
          </div>
        }
      />

      <div className="px-5 pb-6">
        {/* 사업자 정보 안내 */}
        <div className="bg-gray-50 rounded-xl px-4 py-3 mb-4 text-[11px] text-gray-600 leading-relaxed">
          정보의 정확성 및 이미지 저작권, 내용상의 오류나 지연, 사용자가 본 정보를
          신뢰하여 취한 조치에 대해 책임지지 않으므로 상세 내용은 반드시 해당
          업체에 직접 확인해주세요.
        </div>

        {/* 제목 + 본문 */}
        <h1 className="text-[18px] font-extrabold tracking-tight">{ad.title}</h1>
        {ad.body && (
          <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">
            {ad.body}
          </div>
        )}

        {/* 담당자 정보 */}
        <div className="mt-6 grid grid-cols-[80px_1fr] gap-x-4 gap-y-2 text-[13px]">
          {ad.contact_phone && (
            <>
              <div className="font-extrabold text-gray-700">연락처</div>
              <div className="text-gray-900">{ad.contact_phone}</div>
            </>
          )}
          {ad.contact_kakao && (
            <>
              <div className="font-extrabold text-gray-700">카카오</div>
              <div className="text-gray-900">{ad.contact_kakao}</div>
            </>
          )}
        </div>

        {/* 사업자정보 */}
        {advertiser && (
          <div className="mt-6 pt-4 border-t border-gray-200 grid grid-cols-[80px_1fr] gap-x-4 gap-y-2 text-[13px]">
            {advertiser.business_name && (
              <>
                <div className="font-extrabold text-gray-700">사업자상호</div>
                <div className="text-gray-900">{advertiser.business_name}</div>
              </>
            )}
            {advertiser.business_address && (
              <>
                <div className="font-extrabold text-gray-700">사업자주소</div>
                <div className="text-gray-900">{advertiser.business_address}</div>
              </>
            )}
            {advertiser.business_address_detail && (
              <>
                <div className="font-extrabold text-gray-700">세부주소</div>
                <div className="text-gray-900">{advertiser.business_address_detail}</div>
              </>
            )}
            {advertiser.business_owner && (
              <>
                <div className="font-extrabold text-gray-700">사업자대표</div>
                <div className="text-gray-900">{advertiser.business_owner}</div>
              </>
            )}
          </div>
        )}

        {/* 광고 기간 */}
        {(ad.start_at || ad.end_at) && (
          <div className="mt-6 pt-4 border-t border-gray-200 grid grid-cols-[80px_1fr] gap-x-4 gap-y-2 text-[13px]">
            {ad.start_at && (
              <>
                <div className="font-extrabold text-gray-700">광고 시작</div>
                <div className="text-gray-900">{formatDateKo(ad.start_at)}</div>
              </>
            )}
            {ad.end_at && (
              <>
                <div className="font-extrabold text-gray-700">광고 마감</div>
                <div className="text-gray-900">
                  {formatDateKo(ad.end_at)}
                  {remainDays !== null && (
                    <span className="ml-1.5 text-green-600 font-extrabold text-[11px]">
                      {remainDays}일 남음
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 신고/주의 링크 */}
        <div className="mt-6 pt-4 border-t border-gray-200 space-y-3">
          {["허위광고 신고", "취업사기 주의", "체불사업자 명단"].map((t) => (
            <div
              key={t}
              className="flex items-center justify-between text-[14px] font-extrabold text-gray-700 py-1"
            >
              <span>{t}</span>
              <span className="text-gray-400">›</span>
            </div>
          ))}
        </div>
      </div>

      {/* 하단 액션바 (fixed) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2 max-w-[420px] mx-auto">
        <button
          type="button"
          className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center text-[18px]"
        >
          🔖
        </button>
        {ad.contact_phone && (
          <a
            href={`tel:${ad.contact_phone}`}
            className="flex-1 bg-gray-200 rounded-xl py-3 text-[13px] font-extrabold text-center text-gray-800 no-underline"
          >
            전화하기
          </a>
        )}
        <button
          type="button"
          onClick={startTalk}
          className="flex-1 bg-black text-white rounded-xl py-3 text-[13px] font-extrabold"
        >
          1:1 채팅
        </button>
      </div>
    </div>
  )
}

function formatDateKo(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}
