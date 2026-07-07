"use client"
import { use, useEffect, useState } from "react"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"

type Guest = {
  id: string
  display_name: string
  phone: string | null
  tags: string[]
  style_prefs: string[]
  memo: string | null
  visit_count: number
  last_visit_at: string | null
  total_spent: number
  is_blacklisted: boolean
}
type Visit = {
  id: string
  session_id: string | null
  tags: string[]
  total_amount: number | null
  tc_count: number | null
  memo: string | null
  created_at: string
}

export default function GuestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [guest, setGuest] = useState<Guest | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch(`/api/guests/${id}`)
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          setGuest(j.guest)
          setVisits(j.visits ?? [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="p-5 space-y-2">
        <div className="h-20 rounded-2xl bg-[#EFEBE3] animate-pulse" />
      </div>
    )
  }
  if (!guest) return <div className="p-6 text-center text-[#7A746A]">손님을 찾을 수 없습니다</div>

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="손님 정보" backHref="/m/guests" />

      <div className="px-5 pb-24">
        {/* 프로필 카드 */}
        <div
          className={`rounded-3xl p-5 mb-4 ${
            guest.is_blacklisted ? "bg-red-50 border border-red-200" : "bg-white border border-[#D8D2C8]/60"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-[24px] font-extrabold ${
                guest.is_blacklisted ? "bg-red-100 text-red-600" : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white"
              }`}
            >
              {guest.display_name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[18px] font-extrabold tracking-tight truncate">
                {guest.display_name}
              </div>
              {guest.phone && (
                <div className="text-[11px] text-[#7A746A] mt-0.5">{guest.phone}</div>
              )}
              {guest.is_blacklisted && (
                <div className="text-[10px] font-extrabold text-red-600 mt-1">
                  ⚠️ 블랙 리스트
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-[#D8D2C8]/40">
            <Stat label="방문" value={`${guest.visit_count}회`} />
            <Stat label="총 지출" value={`${Math.round(guest.total_spent / 10000)}만`} />
            <Stat
              label="최근"
              value={guest.last_visit_at ? formatRelative(guest.last_visit_at) : "-"}
            />
          </div>
        </div>

        {/* 태그 */}
        {guest.tags.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5 uppercase tracking-wider">
              특징
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guest.tags.map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-extrabold text-[#A87D45] bg-[#C49B61]/15 px-2.5 py-1 rounded-full"
                >
                  #{t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 취향 */}
        {guest.style_prefs.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5 uppercase tracking-wider">
              선호 스타일
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guest.style_prefs.map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-extrabold text-purple-700 bg-purple-100 px-2.5 py-1 rounded-full"
                >
                  ✨ {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 메모 */}
        {guest.memo && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-[12px] leading-relaxed whitespace-pre-wrap">
            {guest.memo}
          </div>
        )}

        {/* 방문 이력 */}
        <div className="text-[10px] font-extrabold text-[#7A746A] mb-2 uppercase tracking-wider">
          방문 이력 ({visits.length})
        </div>
        {visits.length === 0 ? (
          <div className="text-center text-[12px] text-[#7A746A] py-6">기록 없음</div>
        ) : (
          <div className="space-y-2">
            {visits.map((v) => (
              <div key={v.id} className="bg-white rounded-2xl border border-[#D8D2C8]/40 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-extrabold">
                    {new Date(v.created_at).toLocaleDateString("ko-KR")}
                  </div>
                  {v.total_amount != null && (
                    <div className="text-[11px] font-extrabold text-[#A87D45]">
                      {Math.round(v.total_amount / 10000)}만원
                    </div>
                  )}
                </div>
                {v.tc_count != null && (
                  <div className="text-[10px] text-[#7A746A] mt-0.5">타임 {v.tc_count}회</div>
                )}
                {v.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {v.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] font-bold text-[#7A746A] bg-[#EFEBE3] px-1.5 py-0.5 rounded"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                {v.memo && (
                  <div className="text-[10px] text-[#7A746A] italic mt-1">{v.memo}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[14px] font-extrabold">{value}</div>
      <div className="text-[9px] font-bold text-[#7A746A] mt-0.5">{label}</div>
    </div>
  )
}
function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60_000))
  if (days === 0) return "오늘"
  if (days < 30) return `${days}일 전`
  return `${Math.floor(days / 30)}달 전`
}
