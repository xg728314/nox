"use client"

/**
 * /cafe/[store_uuid] — 배민 스타일 카페 메뉴 + 장바구니.
 *   white background, 카드 그리드, 클릭 시 상세 모달.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import type { CafeMenuItem, CafeOrderItem, CafePaymentMethod } from "@/lib/cafe/types"
import CafeMenuDetailModal from "@/components/cafe/CafeMenuDetailModal"
import CafeCartModal from "@/components/cafe/CafeCartModal"

type CartLine = {
  key: string                // unique line key (menu_id + sorted option_ids)
  menu_id: string
  name: string
  price: number              // base
  unit_price: number         // base + options
  qty: number
  thumbnail_url: string | null
  options: Array<{ option_id: string; name: string; price_delta: number }>
}

function fmt(n: number) { return n.toLocaleString() + "원" }

export default function CafeStorePage() {
  const params = useParams()
  const storeId = params.store_uuid as string
  const [storeName, setStoreName] = useState<string>("")
  const [menu, setMenu] = useState<CafeMenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      // 2026-05-02 R-Cafe-Speed: stores + menu + account 단일 endpoint 통합 (1 RTT).
      const r = await apiFetch(`/api/cafe/storefront/${storeId}`)
      if (!r.ok) { setError("로드 실패"); return }
      const d = await r.json()
      setStoreName(d.store?.name ?? "")
      const m = (d.menu ?? []) as CafeMenuItem[]
      setMenu(m)
      if (m.length > 0 && !activeCat) setActiveCat(m[0].category)
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [storeId, activeCat])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const m of menu) set.add(m.category)
    return Array.from(set)
  }, [menu])
  const filteredMenu = activeCat ? menu.filter((m) => m.category === activeCat) : menu

  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const cartSubtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0)

  function addToCart(line: Omit<CartLine, "key">) {
    const optKey = (line.options ?? []).map((o) => o.option_id).sort().join(",")
    const key = `${line.menu_id}::${optKey}`
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + line.qty }
        return next
      }
      return [...prev, { ...line, key }]
    })
    setOpenMenuId(null)
  }
  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.key !== key) return [l]
        const q = l.qty + delta
        if (q <= 0) return []
        return [{ ...l, qty: q }]
      }),
    )
  }
  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key))
  }
  function clearCart() { setCart([]); setCartOpen(false) }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => history.back()} className="text-gray-700 text-xl">←</button>
            <span className="text-base font-bold">{storeName || "카페"}</span>
          </div>
          <div className="text-xs text-gray-500">☕</div>
        </div>
        {/* 카테고리 탭 (배민 스타일) */}
        {categories.length > 0 && (
          <div className="overflow-x-auto border-t border-gray-100 px-4 py-2 flex gap-2 scrollbar-none">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap font-semibold ${
                  activeCat === c ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >{c}</button>
            ))}
          </div>
        )}
      </header>

      {error && <div className="max-w-2xl mx-auto px-4 mt-3 p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

      {loading ? (
        <div className="p-12 text-center text-gray-400 text-sm">불러오는 중…</div>
      ) : menu.length === 0 ? (
        <div className="p-12 text-center text-gray-400 text-sm">등록된 메뉴가 없습니다</div>
      ) : (
        <main className="max-w-2xl mx-auto px-4 py-3 pb-32">
          {activeCat && (
            <h2 className="text-lg font-bold mb-3 mt-2">{activeCat}</h2>
          )}
          <div className="space-y-3">
            {filteredMenu.map((m) => (
              <button
                key={m.id}
                onClick={() => setOpenMenuId(m.id)}
                className="w-full flex gap-3 items-stretch p-3 rounded-xl border border-gray-100 hover:border-gray-300 transition-colors text-left bg-white"
              >
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="font-bold text-base truncate">{m.name}</div>
                  {m.description && (
                    <div className="text-xs text-gray-500 line-clamp-2 mt-1">{m.description}</div>
                  )}
                  <div className="mt-auto text-base font-bold pt-2">{fmt(m.price)}</div>
                </div>
                <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center text-gray-300 flex-shrink-0">
                  {(m.thumbnail_url || m.image_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbnail_url || m.image_url || ""} alt={m.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🍴</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </main>
      )}

      {/* 하단 장바구니 floating bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg">
          <div className="max-w-2xl mx-auto p-3">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full bg-gray-900 text-white rounded-xl py-3.5 flex items-center justify-between px-4 active:scale-[0.98] transition-transform"
            >
              <span className="flex items-center gap-2">
                <span className="bg-white text-gray-900 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">{cartCount}</span>
                <span className="font-bold">장바구니 보기</span>
              </span>
              <span className="font-bold">{fmt(cartSubtotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* 메뉴 상세 모달 */}
      {openMenuId && (
        <CafeMenuDetailModal
          menuId={openMenuId}
          onClose={() => setOpenMenuId(null)}
          onAdd={addToCart}
        />
      )}

      {/* 장바구니 모달 */}
      {cartOpen && (
        <CafeCartModal
          cafeStoreUuid={storeId}
          cafeStoreName={storeName}
          cart={cart}
          onChangeQty={changeQty}
          onRemoveLine={removeLine}
          onClear={clearCart}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  )
}
