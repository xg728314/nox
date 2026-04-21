"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

type Item = {
  id: string
  name: string
  unit: string
  current_stock: number
  min_stock: number
  unit_cost: number
  store_price: number
  cost_per_box: number
  cost_per_unit: number
  units_per_box: number
  converted_stock: number
  is_active: boolean
  is_low_stock: boolean
  is_out_of_stock: boolean
}

type Summary = { total: number; low_stock: number; out_of_stock: number }

type TabKey = "list" | "add" | "stock" | "trace"

type TraceDetail = { order_id: string; time: string; room_label: string; bottles: number }
type TraceManager = { manager_name: string; bottles: number; amount: number; details: TraceDetail[] }
type TraceItem = {
  id: string
  name: string
  unit: string
  units_per_box: number
  current_stock: number
  current_bottles: number
  store_price: number
  bottles_sold_today: number
  amount_today: number
  managers: TraceManager[]
}
type TraceEntry = { time: string; manager_name: string; room_label: string; item_name: string; bottles: number }

export default function InventoryPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("list")
  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, low_stock: 0, out_of_stock: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  // 품목 등록 폼
  const [form, setForm] = useState({ name: "", unit: "병", current_stock: "", min_stock: "", store_price: "", cost_per_box: "", units_per_box: "" })
  const needsUnitsPerBox = form.unit === "박스"
  const boxPreview = needsUnitsPerBox && Number(form.units_per_box) >= 1
    ? `환산 재고: ${Number(form.current_stock) || 0}박스 × ${Number(form.units_per_box)}병 = ${(Number(form.current_stock) || 0) * Number(form.units_per_box)}병`
    : ""
  const SELECT_CLS = "w-full rounded-xl bg-[#0b1220] border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 [&>option]:bg-[#0b1220] [&>option]:text-white"
  const [submitting, setSubmitting] = useState(false)

  // 입출고 폼
  const [txForm, setTxForm] = useState({ item_id: "", type: "in", quantity: "", memo: "" })
  const [txSubmitting, setTxSubmitting] = useState(false)

  // 판매 추적
  const [traceItems, setTraceItems] = useState<TraceItem[]>([])
  const [trace, setTrace] = useState<TraceEntry[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null) // `${itemId}::${managerName}`

  const profile = useCurrentProfile()
  const role = profile?.role ?? null

  useEffect(() => {
    fetchItems()
  }, [])

  async function fetchItems() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/inventory/items")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setItems(data.items ?? [])
        setSummary(data.summary ?? { total: 0, low_stock: 0, out_of_stock: 0 })
      }
    } catch {
      setError("품목 목록을 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError("품목명을 입력하세요."); return }
    if (needsUnitsPerBox) {
      const upb = Number(form.units_per_box)
      if (!Number.isInteger(upb) || upb < 1) {
        setError("박스 단위 품목은 박스당 수량(1 이상 정수)이 필요합니다.")
        return
      }
    }
    setSubmitting(true); setError("")
    try {
      const res = await apiFetch("/api/inventory/items", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          unit: form.unit,
          current_stock: Number(form.current_stock) || 0,
          min_stock: Number(form.min_stock) || 0,
          store_price: Number(form.store_price) || 0,
          cost_per_box: Number(form.cost_per_box) || 0,
          units_per_box: needsUnitsPerBox ? Number(form.units_per_box) : 1,
        }),
      })
      if (res.ok) {
        setSuccessMsg("품목 등록 완료"); setTimeout(() => setSuccessMsg(""), 2000)
        setForm({ name: "", unit: "병", current_stock: "", min_stock: "", store_price: "", cost_per_box: "", units_per_box: "" })
        setTab("list"); fetchItems()
      } else {
        const data = await res.json()
        setError(data.message || "등록 실패")
      }
    } catch { setError("서버 오류") }
    finally { setSubmitting(false) }
  }

  async function fetchTrace() {
    setTraceLoading(true); setError("")
    try {
      const res = await apiFetch("/api/inventory/sales-trace")
      if (res.ok) {
        const data = await res.json()
        setTraceItems(data.items ?? [])
        setTrace(data.trace ?? [])
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.message || "판매 내역을 불러올 수 없습니다.")
      }
    } catch { setError("서버 오류") }
    finally { setTraceLoading(false) }
  }

  async function handleDeleteItem(item: Item) {
    if (role !== "owner") { setError("삭제 권한이 없습니다."); return }
    const ok = typeof window !== "undefined" && window.confirm(`'${item.name}' 품목을 삭제하시겠습니까?\n(과거 거래 이력은 유지되며, 신규 사용에서만 제외됩니다.)`)
    if (!ok) return
    setError("")
    try {
      const res = await apiFetch(`/api/inventory/items/${item.id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        setSuccessMsg("품목 삭제 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.message || "삭제 실패")
      }
    } catch { setError("서버 오류") }
  }

  async function handleTransaction(e: React.FormEvent) {
    e.preventDefault()
    if (!txForm.item_id || !txForm.quantity) { setError("품목과 수량을 입력하세요."); return }
    setTxSubmitting(true); setError("")
    try {
      const res = await apiFetch("/api/inventory/transactions", {
        method: "POST",
        body: JSON.stringify({
          item_id: txForm.item_id,
          type: txForm.type,
          quantity: Number(txForm.quantity),
          memo: txForm.memo.trim() || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSuccessMsg(`${txForm.type === "in" ? "입고" : txForm.type === "out" ? "출고" : txForm.type === "adjust" ? "조정" : "손실"} 완료 (${data.before_stock} → ${data.after_stock})`)
        setTimeout(() => setSuccessMsg(""), 3000)
        setTxForm({ ...txForm, quantity: "", memo: "" })
        fetchItems()
      } else {
        const data = await res.json()
        setError(data.message || "처리 실패")
      }
    } catch { setError("서버 오류") }
    finally { setTxSubmitting(false) }
  }

  function fmt(v: number): string {
    return v.toLocaleString()
  }

  const TX_TYPES = [
    { key: "in", label: "입고", color: "text-emerald-300" },
    { key: "out", label: "출고", color: "text-red-300" },
    { key: "adjust", label: "조정", color: "text-cyan-300" },
    { key: "loss", label: "손실", color: "text-amber-300" },
  ]

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push(role === "owner" ? "/owner" : "/manager")} className="text-cyan-400 text-sm">← 대시보드</button>
          <span className="font-semibold">재고 관리</span>
          <div className="w-16" />
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}<button onClick={() => setError("")} className="ml-2 underline text-xs">닫기</button>
          </div>
        )}
        {successMsg && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">{successMsg}</div>
        )}

        {/* 탭 */}
        <div className="px-4 pt-4 flex gap-2">
          {([
            { key: "list" as TabKey, label: "품목 목록" },
            { key: "trace" as TabKey, label: "판매 추적" },
            { key: "stock" as TabKey, label: "입출고" },
            ...(role === "owner" ? [{ key: "add" as TabKey, label: "품목 등록" }] : []),
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); if (t.key === "trace" && traceItems.length === 0) fetchTrace() }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === t.key ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-white/5 text-slate-400 border border-white/10"
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* === 품목 목록 === */}
        {tab === "list" && (
          <div className="px-4 py-4 space-y-4">
            {/* 경고 요약 */}
            {(summary.low_stock > 0 || summary.out_of_stock > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {summary.out_of_stock > 0 && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                    <div className="text-xs text-slate-400">재고 없음</div>
                    <div className="mt-1 text-2xl font-bold text-red-300">{summary.out_of_stock}</div>
                  </div>
                )}
                {summary.low_stock > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="text-xs text-slate-400">저재고 경고</div>
                    <div className="mt-1 text-2xl font-bold text-amber-300">{summary.low_stock}</div>
                  </div>
                )}
              </div>
            )}

            {items.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">등록된 품목이 없습니다.</p>
              </div>
            )}

            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 ${
                    item.is_out_of_stock ? "border-red-500/30 bg-red-500/5" :
                    item.is_low_stock ? "border-amber-500/30 bg-amber-500/5" :
                    "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-xs text-slate-500">{item.unit}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.is_out_of_stock && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">재고없음</span>
                      )}
                      {item.is_low_stock && !item.is_out_of_stock && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">저재고</span>
                      )}
                      {role === "owner" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item)}
                          className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400 hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/30 transition-colors"
                        >삭제</button>
                      )}
                    </div>
                  </div>
                  {/* 재고 표시 — 박스/병 단위를 명시적으로 풀어 쓴다. */}
                  <div className="space-y-0.5 text-xs">
                    {item.unit === "박스" && item.units_per_box > 1 ? (
                      <>
                        <div className="text-slate-400">1박스 = <span className="text-white">{item.units_per_box}병</span></div>
                        <div className="text-slate-400">현재 <span className={`font-semibold ${item.is_out_of_stock ? "text-red-300" : item.is_low_stock ? "text-amber-300" : "text-white"}`}>{fmt(item.current_stock)}박스</span> <span className="text-slate-500">({fmt(item.converted_stock)}병)</span></div>
                        <div className="text-slate-400">총 재고 <span className="text-cyan-300 font-semibold">{fmt(item.converted_stock)}병</span></div>
                      </>
                    ) : (
                      <>
                        <div className="text-slate-400">현재 <span className={`font-semibold ${item.is_out_of_stock ? "text-red-300" : item.is_low_stock ? "text-amber-300" : "text-white"}`}>{fmt(item.current_stock)}{item.unit}</span></div>
                        <div className="text-slate-400">총 재고 <span className="text-cyan-300 font-semibold">{fmt(item.current_stock)}{item.unit}</span></div>
                      </>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                    <div>최소 <span className="text-slate-300">{fmt(item.min_stock)}{item.unit}</span></div>
                    <div>입금가 <span className="text-slate-300">{fmt(item.store_price || item.unit_cost)}원</span></div>
                    <div>재고금액 <span className="text-slate-300">{fmt(item.current_stock * (item.store_price || item.unit_cost))}원</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === 판매 추적 === */}
        {tab === "trace" && (
          <div className="px-4 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">오늘 영업일 기준 주류 판매 내역</span>
              <button
                onClick={fetchTrace}
                disabled={traceLoading}
                className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >{traceLoading ? "불러오는 중..." : "새로고침"}</button>
            </div>

            {traceLoading && traceItems.length === 0 && (
              <div className="text-slate-500 text-sm text-center py-8">불러오는 중...</div>
            )}

            {!traceLoading && traceItems.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">표시할 품목이 없습니다.</p>
              </div>
            )}

            {traceItems.map((it) => {
              const hasSales = it.bottles_sold_today > 0
              return (
                <div key={it.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  {/* 품목 헤더 + 일일 요약 */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{it.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {it.unit === "박스" && it.units_per_box > 1
                          ? `1박스 = ${it.units_per_box}병 · 현재 ${fmt(it.current_stock)}박스 (${fmt(it.current_bottles)}병)`
                          : `현재 ${fmt(it.current_stock)}${it.unit}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500">오늘 판매</div>
                      <div className="text-sm font-bold text-cyan-300">{fmt(it.bottles_sold_today)}병</div>
                      <div className="text-[11px] text-slate-400">{fmt(it.amount_today)}원</div>
                    </div>
                  </div>

                  {hasSales ? (
                    <div className="space-y-1">
                      {it.managers.map((m) => {
                        const key = `${it.id}::${m.manager_name}`
                        const expanded = expandedKey === key
                        return (
                          <div key={key} className="rounded-xl bg-black/20 border border-white/5">
                            <button
                              type="button"
                              onClick={() => setExpandedKey(expanded ? null : key)}
                              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500">{expanded ? "▼" : "▶"}</span>
                                <span className="text-sm text-white font-medium">{m.manager_name}</span>
                                <span className="text-xs text-slate-400">{fmt(m.bottles)}병</span>
                              </div>
                              <span className="text-xs text-emerald-300 font-semibold">{fmt(m.amount)}원</span>
                            </button>
                            {expanded && (
                              <div className="px-3 pb-2 pt-1 border-t border-white/5 space-y-0.5">
                                {m.details.map((d) => (
                                  <div key={d.order_id} className="flex items-center justify-between text-[11px]">
                                    <div className="flex items-center gap-2 text-slate-400">
                                      <span className="text-slate-500">{d.room_label}</span>
                                      <span className="text-slate-600">/</span>
                                      <span>{fmt(d.bottles)}병</span>
                                    </div>
                                    <span className="text-slate-500">{new Date(d.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600 text-center py-2">오늘 판매 내역 없음</div>
                  )}
                </div>
              )
            })}

            {/* 전체 타임라인 */}
            {trace.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-xs text-slate-400 mb-2 font-semibold">최근 판매 기록</div>
                <div className="space-y-0.5">
                  {trace.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-slate-400 py-1 border-b border-white/5 last:border-0">
                      <span className="text-slate-500 w-10">{new Date(t.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="text-slate-300 w-16 truncate">{t.manager_name}</span>
                      <span className="text-slate-500 w-14 truncate">{t.room_label}</span>
                      <span className="text-white flex-1 truncate">{t.item_name}</span>
                      <span className="text-cyan-300 font-medium">{fmt(t.bottles)}병</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === 품목 등록 === */}
        {tab === "add" && role === "owner" && (
          <form onSubmit={handleAddItem} className="px-4 py-4 space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">품목명 *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="품목명" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">재고 단위 *</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className={SELECT_CLS}>
                {["병", "박스", "개", "팩", "kg", "ea"].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">초기 재고</label>
                <input type="number" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: e.target.value })}
                  min="0" placeholder="0" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">최소 재고</label>
                <input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  min="0" placeholder="0" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">입금가 (원)</label>
                <input type="number" value={form.store_price} onChange={(e) => setForm({ ...form, store_price: e.target.value })}
                  min="0" placeholder="0" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {needsUnitsPerBox ? "원가 (박스당)" : "원가 (단위당)"}
                </label>
                <input type="number" value={form.cost_per_box} onChange={(e) => setForm({ ...form, cost_per_box: e.target.value })}
                  min="0" placeholder="0" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
              </div>
            </div>
            {needsUnitsPerBox && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">박스당 수량 * <span className="text-slate-500">(박스 단위 전용)</span></label>
                <input type="number" value={form.units_per_box} onChange={(e) => setForm({ ...form, units_per_box: e.target.value })}
                  min="1" step="1" placeholder="6"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
              </div>
            )}
            {boxPreview && (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
                {boxPreview}
                {form.cost_per_box && Number(form.cost_per_box) > 0 && Number(form.units_per_box) >= 1 && (
                  <span className="ml-2 text-slate-400">(원가 병당 {fmt(Math.round(Number(form.cost_per_box) / Number(form.units_per_box)))}원)</span>
                )}
              </div>
            )}
            <button type="submit" disabled={submitting}
              className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm transition-all disabled:opacity-50">
              {submitting ? "등록 중..." : "품목 등록"}
            </button>
          </form>
        )}

        {/* === 입출고 === */}
        {tab === "stock" && (
          <form onSubmit={handleTransaction} className="px-4 py-4 space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">품목 *</label>
              <select value={txForm.item_id} onChange={(e) => setTxForm({ ...txForm, item_id: e.target.value })}
                className={SELECT_CLS}>
                <option value="">선택</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} (현재: {i.current_stock}{i.unit})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">처리 유형 *</label>
              <div className="grid grid-cols-4 gap-2">
                {TX_TYPES.map((t) => (
                  <button key={t.key} type="button" onClick={() => setTxForm({ ...txForm, type: t.key })}
                    className={`py-2 rounded-xl text-sm font-medium transition-all ${
                      txForm.type === t.key ? `bg-cyan-500/20 ${t.color} border border-cyan-500/40` : "bg-white/5 text-slate-400 border border-white/10"
                    }`}>{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {txForm.type === "adjust" ? "조정 후 수량 *" : "수량 *"}
              </label>
              <input type="number" value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })}
                min="1" placeholder="0" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">메모</label>
              <input type="text" value={txForm.memo} onChange={(e) => setTxForm({ ...txForm, memo: e.target.value })}
                placeholder="사유 (선택)" className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600" />
            </div>
            <button type="submit" disabled={txSubmitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all disabled:opacity-50">
              {txSubmitting ? "처리 중..." : "재고 처리"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
