"use client"

import { useState } from "react"
import type { InventoryItem } from "../../types"
import { fmtWon } from "../../helpers"

type Props = {
  items: InventoryItem[]
  busy: boolean
  onClose: () => void
  onAdd: (item: { name: string; category: string; unit: string; unit_cost: number; current_stock: number }) => void
  onRefresh: () => void
}

export default function InventoryModal({ items, busy, onClose, onAdd, onRefresh }: Props) {
  const [tab, setTab] = useState<"list" | "add">("list")
  const [form, setForm] = useState({ name: "", category: "주류", unit: "병", unit_cost: 0, current_stock: 0 })
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? items.filter(i => i.name.includes(search.trim()) || i.category.includes(search.trim()))
    : items

  // Group by category
  const grouped = filtered.reduce<Record<string, InventoryItem[]>>((acc, it) => {
    const cat = it.category || "기타"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(it)
    return acc
  }, {})

  function handleSubmit() {
    if (!form.name.trim()) return
    onAdd({
      name: form.name.trim(),
      category: form.category,
      unit: form.unit,
      unit_cost: form.unit_cost,
      current_stock: form.current_stock,
    })
    setForm({ name: "", category: "주류", unit: "병", unit_cost: 0, current_stock: 0 })
    setTab("list")
  }

  const CATEGORIES = ["주류", "안주", "음료", "기타"]
  const UNITS = ["병", "잔", "개", "세트", "인분"]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-3 top-[10%] bottom-[10%] z-50 flex flex-col bg-[#0d1020] border border-white/10 rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold">재고 관리</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
              {items.length}개 품목
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab("list")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === "list" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400"}`}
          >품목 목록</button>
          <button
            onClick={() => setTab("add")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === "add" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400"}`}
          >품목 추가</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "list" ? (
            <div className="p-3 space-y-3">
              {/* Search */}
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="품목 검색..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              />

              {/* Low stock warning */}
              {items.some(i => i.is_low_stock) && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-400">
                  저재고 경고: {items.filter(i => i.is_low_stock).map(i => i.name).join(", ")}
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm">
                  {search ? "검색 결과 없음" : "등록된 품목이 없습니다"}
                </div>
              ) : (
                Object.entries(grouped).map(([cat, catItems]) => (
                  <div key={cat}>
                    <div className="text-[11px] text-slate-500 font-semibold mb-1.5 px-1">{cat}</div>
                    <div className="space-y-1">
                      {catItems.map(item => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white font-medium truncate">{item.name}</div>
                            <div className="text-[10px] text-slate-500">{fmtWon(item.unit_cost)}/{item.unit}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`text-sm font-bold ${item.is_out_of_stock ? "text-red-400" : item.is_low_stock ? "text-amber-400" : "text-emerald-400"}`}>
                              {item.current_stock}{item.unit}
                            </div>
                            {item.is_out_of_stock && <div className="text-[9px] text-red-400">품절</div>}
                            {item.is_low_stock && !item.is_out_of_stock && <div className="text-[9px] text-amber-400">저재고</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Refresh */}
              <button
                onClick={onRefresh}
                className="w-full py-2 rounded-lg bg-white/5 text-slate-400 text-xs hover:bg-white/10 transition-colors"
              >새로고침</button>
            </div>
          ) : (
            /* Add form */
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">품목명</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 발렌타인 17년"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">분류</label>
                <div className="flex gap-1.5">
                  {CATEGORIES.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(f => ({ ...f, category: c }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        form.category === c
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                          : "bg-white/5 text-slate-400 border border-white/[0.06] hover:bg-white/10"
                      }`}
                    >{c}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-500 mb-1 block">단위</label>
                  <div className="flex gap-1">
                    {UNITS.map(u => (
                      <button
                        key={u}
                        onClick={() => setForm(f => ({ ...f, unit: u }))}
                        className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                          form.unit === u
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                            : "bg-white/5 text-slate-400 border border-white/[0.06]"
                        }`}
                      >{u}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 mb-1 block">단가 (원)</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={form.unit_cost}
                    onChange={e => setForm(f => ({ ...f, unit_cost: Math.max(0, Number(e.target.value)) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">초기 재고</label>
                <input
                  type="number"
                  min={0}
                  value={form.current_stock}
                  onChange={e => setForm(f => ({ ...f, current_stock: Math.max(0, Number(e.target.value)) }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setTab("list")}
                  className="flex-1 py-2.5 rounded-lg bg-white/5 text-slate-300 text-sm hover:bg-white/10 transition-colors"
                >취소</button>
                <button
                  onClick={handleSubmit}
                  disabled={busy || !form.name.trim() || form.unit_cost <= 0}
                  className="flex-1 py-2.5 rounded-lg bg-cyan-500/80 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-500 transition-colors"
                >등록</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
