"use client"

/**
 * CafeMenuDetailModal — 배민 스타일 메뉴 상세.
 *   상단 큰 이미지, 이름/설명/가격, 옵션 그룹, 수량, 리뷰 list, 장바구니 담기.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type MenuDetail = {
  menu: {
    id: string
    store_uuid: string
    name: string
    category: string
    price: number
    description: string | null
    description_long: string | null
    image_url: string | null
    thumbnail_url: string | null
  }
  option_groups: Array<{
    id: string
    name: string
    is_required: boolean
    min_select: number
    max_select: number
    options: Array<{ id: string; name: string; price_delta: number; is_default: boolean }>
  }>
  reviews: Array<{
    id: string
    rating: number
    text: string | null
    created_at: string
    customer_name: string
  }>
  review_summary: { avg_rating: number | null; count: number }
}

type AddedLine = {
  menu_id: string
  name: string
  price: number
  unit_price: number
  qty: number
  thumbnail_url: string | null
  options: Array<{ option_id: string; name: string; price_delta: number }>
}

type Props = {
  menuId: string
  onClose: () => void
  onAdd: (line: AddedLine) => void
}

function fmt(n: number) { return n.toLocaleString() + "원" }
function fmtSign(n: number) { return n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString() }

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating)
  return (
    <span className="text-yellow-500">
      {"★".repeat(full)}<span className="text-gray-200">{"★".repeat(5 - full)}</span>
    </span>
  )
}

export default function CafeMenuDetailModal({ menuId, onClose, onAdd }: Props) {
  const [data, setData] = useState<MenuDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [qty, setQty] = useState(1)
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})  // group_id -> set of option_ids

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const r = await apiFetch(`/api/cafe/menu/${menuId}/detail`)
        if (cancelled) return
        if (!r.ok) { setError("메뉴 정보 로드 실패"); return }
        const d = (await r.json()) as MenuDetail
        setData(d)
        // default options 자동 선택
        const init: Record<string, Set<string>> = {}
        for (const g of d.option_groups) {
          init[g.id] = new Set(g.options.filter((o) => o.is_default).map((o) => o.id))
        }
        setPicked(init)
      } catch { if (!cancelled) setError("네트워크 오류") }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [menuId])

  if (!loading && !data) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
        <div className="bg-white p-6 rounded-t-2xl sm:rounded-2xl text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-sm text-gray-700">{error || "메뉴를 찾을 수 없음"}</div>
          <button onClick={onClose} className="mt-3 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm">닫기</button>
        </div>
      </div>
    )
  }

  function toggle(g: MenuDetail["option_groups"][number], opt_id: string) {
    setPicked((prev) => {
      const next = { ...prev }
      const set = new Set(next[g.id] ?? [])
      if (g.max_select === 1) {
        set.clear()
        set.add(opt_id)
      } else {
        if (set.has(opt_id)) set.delete(opt_id)
        else if (set.size < g.max_select) set.add(opt_id)
      }
      next[g.id] = set
      return next
    })
  }

  // unit price
  let optionAdds: Array<{ option_id: string; name: string; price_delta: number }> = []
  if (data) {
    for (const g of data.option_groups) {
      const ids = picked[g.id] ?? new Set()
      for (const o of g.options) {
        if (ids.has(o.id)) optionAdds.push({ option_id: o.id, name: o.name, price_delta: o.price_delta })
      }
    }
  }
  const optSum = optionAdds.reduce((s, o) => s + o.price_delta, 0)
  const unitPrice = (data?.menu.price ?? 0) + optSum
  const totalPrice = unitPrice * qty

  function canAdd(): boolean {
    if (!data) return false
    for (const g of data.option_groups) {
      if (g.is_required) {
        const c = (picked[g.id]?.size ?? 0)
        if (c < g.min_select) return false
      }
    }
    return true
  }

  function handleAdd() {
    if (!data || !canAdd()) return
    onAdd({
      menu_id: data.menu.id,
      name: data.menu.name,
      price: data.menu.price,
      unit_price: unitPrice,
      qty,
      thumbnail_url: data.menu.thumbnail_url,
      options: optionAdds,
    })
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl flex flex-col">
        {/* 닫기 + 이미지 */}
        <div className="relative">
          <button onClick={onClose}
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-700">✕</button>
          {loading ? (
            <div className="aspect-square bg-gray-100 animate-pulse" />
          ) : data?.menu.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.menu.image_url} alt={data.menu.name} className="w-full aspect-square object-cover" />
          ) : (
            <div className="aspect-square bg-gray-100 flex items-center justify-center text-7xl text-gray-300">🍴</div>
          )}
        </div>

        {data && (
          <div className="px-5 py-4 space-y-4">
            {/* 이름 + 가격 */}
            <div>
              <div className="text-xl font-bold">{data.menu.name}</div>
              {data.review_summary.count > 0 && (
                <div className="flex items-center gap-1.5 text-xs mt-1">
                  <Stars rating={data.review_summary.avg_rating ?? 0} />
                  <span className="text-gray-700 font-semibold">{data.review_summary.avg_rating?.toFixed(1)}</span>
                  <span className="text-gray-400">리뷰 {data.review_summary.count}</span>
                </div>
              )}
              {data.menu.description && (
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{data.menu.description}</p>
              )}
              {data.menu.description_long && (
                <p className="text-xs text-gray-500 mt-2 whitespace-pre-line border-t border-gray-100 pt-2">{data.menu.description_long}</p>
              )}
              <div className="text-2xl font-bold mt-3">{fmt(data.menu.price)}</div>
            </div>

            {/* 옵션 그룹 */}
            {data.option_groups.map((g) => (
              <div key={g.id} className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold">{g.name}</span>
                  {g.is_required && (
                    <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">필수</span>
                  )}
                  <span className="text-[10px] text-gray-400 ml-auto">
                    {g.max_select === 1 ? "1개 선택" : `최대 ${g.max_select}개`}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.options.map((o) => {
                    const checked = picked[g.id]?.has(o.id) ?? false
                    return (
                      <label key={o.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center gap-2.5">
                          <input
                            type={g.max_select === 1 ? "radio" : "checkbox"}
                            name={`g-${g.id}`}
                            checked={checked}
                            onChange={() => toggle(g, o.id)}
                            className="accent-gray-900"
                          />
                          <span className="text-sm">{o.name}</span>
                        </div>
                        <span className={`text-sm tabular-nums ${o.price_delta > 0 ? "text-gray-700" : "text-gray-400"}`}>
                          {o.price_delta !== 0 ? fmtSign(o.price_delta) : "-"}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* 수량 */}
            <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
              <span className="font-bold">수량</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-full border border-gray-300 text-lg disabled:opacity-30"
                  disabled={qty <= 1}>−</button>
                <span className="w-6 text-center font-bold tabular-nums">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(99, q + 1))}
                  className="w-9 h-9 rounded-full border border-gray-300 text-lg">＋</button>
              </div>
            </div>

            {/* 리뷰 */}
            {data.reviews.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="font-bold mb-2">리뷰 ({data.review_summary.count})</div>
                <div className="space-y-3">
                  {data.reviews.slice(0, 5).map((r) => (
                    <div key={r.id} className="p-3 rounded-lg bg-gray-50">
                      <div className="flex items-center justify-between text-xs">
                        <Stars rating={r.rating} />
                        <span className="text-gray-400">{r.customer_name}</span>
                      </div>
                      {r.text && <div className="text-sm text-gray-700 mt-1.5 whitespace-pre-line">{r.text}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 하단 고정 — 장바구니 담기 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3">
          <button
            onClick={handleAdd}
            disabled={!canAdd()}
            className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3.5 font-bold flex items-center justify-between px-4"
          >
            <span>{qty}개 장바구니 담기</span>
            <span>{fmt(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
