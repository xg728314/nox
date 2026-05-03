"use client"

/**
 * /cafe/manage/store — 매장관리 (소모품). 입고 + 조정 + 부족 알림 + 이력.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import type { CafeSupply } from "@/lib/cafe/types"

function fmtNum(n: number) { return Number.isInteger(n) ? n.toString() : n.toFixed(1) }

export default function CafeStoreManagePage() {
  const [supplies, setSupplies] = useState<CafeSupply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [unit, setUnit] = useState("개")
  const [minStock, setMinStock] = useState<number | "">("")
  const [unitCost, setUnitCost] = useState<number | "">("")

  const [purchaseFor, setPurchaseFor] = useState<string | null>(null)
  const [purchaseQty, setPurchaseQty] = useState<number | "">("")
  const [purchaseCost, setPurchaseCost] = useState<number | "">("")

  const [adjustFor, setAdjustFor] = useState<string | null>(null)
  const [adjustDelta, setAdjustDelta] = useState<number | "">("")
  const [adjustReason, setAdjustReason] = useState<"adjust" | "waste">("adjust")
  const [adjustNotes, setAdjustNotes] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await apiFetch("/api/cafe/supplies")
      const d = await r.json()
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      setSupplies(d.supplies ?? [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function add() {
    if (!name.trim()) { setError("이름 필수"); return }
    setError("")
    const r = await apiFetch("/api/cafe/supplies", {
      method: "POST",
      body: JSON.stringify({
        name, category: category || null, unit,
        min_stock: typeof minStock === "number" ? minStock : 0,
        unit_cost: typeof unitCost === "number" ? unitCost : null,
      }),
    })
    const d = await r.json()
    if (!r.ok) { setError(d.message || "추가 실패"); return }
    setName(""); setCategory(""); setUnit("개"); setMinStock(""); setUnitCost("")
    await load()
  }

  async function purchase() {
    if (!purchaseFor || typeof purchaseQty !== "number" || purchaseQty <= 0) return
    await apiFetch("/api/cafe/supplies/purchases", {
      method: "POST",
      body: JSON.stringify({
        supply_id: purchaseFor,
        qty: purchaseQty,
        unit_cost: typeof purchaseCost === "number" ? purchaseCost : null,
      }),
    })
    setPurchaseFor(null); setPurchaseQty(""); setPurchaseCost("")
    await load()
  }

  async function adjust() {
    if (!adjustFor || typeof adjustDelta !== "number" || adjustDelta === 0) return
    await apiFetch(`/api/cafe/supplies/${adjustFor}`, {
      method: "PATCH",
      body: JSON.stringify({
        adjust_delta: adjustDelta,
        adjust_reason: adjustReason,
        adjust_notes: adjustNotes,
      }),
    })
    setAdjustFor(null); setAdjustDelta(""); setAdjustNotes(""); setAdjustReason("adjust")
    await load()
  }

  async function remove(id: string) {
    if (!confirm("삭제?")) return
    await apiFetch(`/api/cafe/supplies/${id}`, { method: "DELETE" })
    await load()
  }

  const lowStock = supplies.filter((s) => Number(s.current_stock) < Number(s.min_stock))
  const byCategory = new Map<string, CafeSupply[]>()
  for (const s of supplies) {
    const key = s.category || "기타"
    const arr = byCategory.get(key) ?? []
    arr.push(s)
    byCategory.set(key, arr)
  }

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <Link href="/cafe/manage" className="text-xs text-cyan-400">← 홈</Link>
          <h1 className="text-lg font-semibold mt-1">📦 매장관리 (소모품)</h1>
        </div>

        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {/* 부족 알람 (모바일에서도 보임) */}
        {lowStock.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 space-y-1">
            <div className="text-sm font-bold text-red-200">⚠️ 재고 부족 ({lowStock.length})</div>
            {lowStock.map((s) => (
              <div key={s.id} className="text-xs text-red-300">
                • {s.name}: <b>{fmtNum(s.current_stock)}</b> / 최소 {fmtNum(s.min_stock)} {s.unit}
              </div>
            ))}
          </div>
        )}

        {/* 신규 소모품 */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3 space-y-2">
          <div className="text-sm font-semibold">+ 새 소모품 등록</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 일회용 컵 8oz)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-sm" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="카테고리 (컵/빨대/원두)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-sm" />
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="단위 (개/g/ml)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-sm" />
            <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="최소 재고 (알람 임계)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-sm" />
            <input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="단가 (선택)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-sm" />
          </div>
          <button onClick={add} className="w-full py-2 rounded-lg bg-cyan-500/30 border border-cyan-500/50 text-cyan-100 text-sm font-semibold">등록</button>
        </div>

        {/* list */}
        {loading ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat}>
            <div className="text-xs text-slate-400 mb-1.5">{cat}</div>
            <div className="space-y-1.5">
              {items.map((s) => {
                const low = Number(s.current_stock) < Number(s.min_stock)
                return (
                  <div key={s.id} className={`rounded-lg border p-2.5 ${low ? "border-red-500/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.04]"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          현재 <b className={low ? "text-red-300" : "text-emerald-300"}>{fmtNum(s.current_stock)}</b>
                          {" / "}최소 {fmtNum(s.min_stock)} {s.unit}
                          {s.unit_cost ? <span className="ml-2 text-slate-500">단가 ₩{s.unit_cost.toLocaleString()}</span> : null}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setPurchaseFor(s.id); setAdjustFor(null) }}
                          className="text-xs px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200">+ 입고</button>
                        <button onClick={() => { setAdjustFor(s.id); setPurchaseFor(null) }}
                          className="text-xs px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200">조정</button>
                        <button onClick={() => remove(s.id)}
                          className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300">✕</button>
                      </div>
                    </div>
                    {purchaseFor === s.id && (
                      <div className="mt-2 pt-2 border-t border-white/5 flex gap-1.5">
                        <input type="number" step="0.1" value={purchaseQty}
                          onChange={(e) => setPurchaseQty(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder={`수량 (${s.unit})`}
                          className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                        <input type="number" value={purchaseCost}
                          onChange={(e) => setPurchaseCost(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="단가 (선택)"
                          className="w-20 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                        <button onClick={purchase}
                          className="text-xs px-2 py-1 rounded bg-emerald-500/30 text-emerald-200">입고</button>
                        <button onClick={() => setPurchaseFor(null)} className="text-xs px-1 text-slate-400">취소</button>
                      </div>
                    )}
                    {adjustFor === s.id && (
                      <div className="mt-2 pt-2 border-t border-white/5 flex gap-1.5 flex-wrap">
                        <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value as "adjust" | "waste")}
                          className="rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs">
                          <option value="adjust">보정</option>
                          <option value="waste">폐기/깨짐</option>
                        </select>
                        <input type="number" step="0.1" value={adjustDelta}
                          onChange={(e) => setAdjustDelta(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="변동 (-N=차감)"
                          className="w-20 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                        <input value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} placeholder="사유"
                          className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                        <button onClick={adjust}
                          className="text-xs px-2 py-1 rounded bg-amber-500/30 text-amber-200">적용</button>
                        <button onClick={() => setAdjustFor(null)} className="text-xs px-1 text-slate-400">취소</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
