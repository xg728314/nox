"use client"
import { useState } from "react"
import Link from "next/link"
import { useApi, invalidateApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../_components/Toast"

type WaitingRequest = {
  id: string
  store_uuid: string
  store_name: string | null
  categories: string[]
  guest_count: number | null
  room_count: number | null
  tags: string[]
  guest_note: string | null
  status: string
  created_at: string
  expires_at: string
}

const CATEGORY_FILTERS = ["전체", "퍼블릭", "하퍼", "셔츠"]

export default function WaitingBoardPage() {
  const toast = useToast()
  const [category, setCategory] = useState("전체")

  const p = new URLSearchParams()
  if (category !== "전체") p.set("category", category)
  const { data, isLoading, refresh } = useApi<{ requests: WaitingRequest[] }>(
    `/api/waiting?${p.toString()}`,
    { ttl: 10_000 },
  )
  const requests = data?.requests ?? []

  async function match(id: string) {
    try {
      const r = await apiFetch(`/api/waiting/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "matched" }),
      })
      if (r.ok) {
        toast("매칭 처리됨", "success")
        invalidateApi("/api/waiting")
      }
    } catch {}
  }

  return (
    <div className="flex flex-col min-h-full bg-[#FAF5EC]">
      <PageHeader
        title="실시간 대기"
        subtitle="매장 간 요청 · 자동 만료 15분"
        backHref="/m/me"
        right={
          <Link
            href="/m/waiting/new"
            className="text-[10px] font-extrabold bg-[#C49B61] text-white rounded-full px-3 py-1.5"
          >
            + 요청
          </Link>
        }
      />

      <div className="px-5 pb-24">
        {/* 필터 */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold border ${
                category === c
                  ? "bg-[#C49B61] border-[#A87D45] text-white"
                  : "bg-white border-[#D8D2C8] text-[#7A746A]"
              }`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => refresh()}
            className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold bg-white border border-[#D8D2C8] text-[#7A746A]"
          >
            🔄
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && requests.length === 0 && (
          <div className="text-center py-10 text-[12px] text-[#7A746A]">
            지금 대기 요청 없음
          </div>
        )}

        <div className="space-y-2">
          {requests.map((r) => {
            const ageMs = Date.now() - new Date(r.created_at).getTime()
            const ageMin = Math.floor(ageMs / 60_000)
            const remainMs = new Date(r.expires_at).getTime() - Date.now()
            const remainMin = Math.max(0, Math.floor(remainMs / 60_000))
            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-[#D8D2C8]/60 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13px] font-extrabold">{r.store_name ?? "?"}</div>
                  <div className="text-[9px] font-bold text-[#7A746A]">
                    {ageMin}분 전 · {remainMin}분 남음
                  </div>
                </div>
                <div className="text-[16px] font-extrabold text-[#A87D45] mb-1">
                  {r.categories.join(" · ")}
                  {r.guest_count && (
                    <span className="text-[13px] ml-1.5">
                      {r.guest_count}인
                      {r.room_count && r.room_count > 0 && `${r.room_count}빵`}
                    </span>
                  )}
                </div>
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] font-bold text-[#7A746A] bg-[#EFEBE3] px-2 py-0.5 rounded-full"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                {r.guest_note && (
                  <div className="text-[11px] text-[#2D2B26] bg-[#FAF5EC] rounded-lg px-3 py-2 mb-2 italic">
                    💬 {r.guest_note}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => match(r.id)}
                    className="flex-1 bg-green-500 text-white rounded-xl py-2 text-[12px] font-extrabold"
                  >
                    ✓ 우리 매장에서 매칭
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
