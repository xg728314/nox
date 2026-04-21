"use client"

import { useState, useRef, useEffect } from "react"
import type { Order, OrderFormState, InventoryItem } from "../types"
import { ORDER_TYPES } from "../types"
import { fmtWon } from "../helpers"

type Props = {
  orders: Order[]
  orderTotal: number
  formOpen: boolean
  form: OrderFormState
  busy: boolean
  inventoryItems: InventoryItem[]
  onSetFormOpen: (v: boolean | ((p: boolean) => boolean)) => void
  onSetForm: (fn: (prev: OrderFormState) => OrderFormState) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onQuickRepeat: (o: Order) => void
}

function typeColor(type: string): string {
  return ORDER_TYPES.find(t => t.value === type)?.color ?? "text-slate-400"
}
function typeLabel(type: string): string {
  return ORDER_TYPES.find(t => t.value === type)?.label ?? type
}

/** Waiter tip presets */
const TIP_PRESETS = [10000, 20000, 30000, 50000]

/** Room fee presets */
const ROOM_FEE_PRESETS = [50000, 100000, 150000, 200000]

export default function OrderSectionV2({
  orders, orderTotal, formOpen, form, busy,
  inventoryItems,
  onSetFormOpen, onSetForm, onAdd, onDelete, onQuickRepeat,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState("")
  const pickerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [pickerOpen])

  useEffect(() => {
    if (pickerOpen && searchRef.current) searchRef.current.focus()
  }, [pickerOpen])

  // Liquor tab: show ALL inventory items (category removed in product-first model).
  // Non-liquor tabs don't use inventory picker; no category filter needed here.
  const liquorItems = inventoryItems
  const filteredItems = pickerSearch.trim()
    ? liquorItems.filter(i => i.name.includes(pickerSearch.trim()))
    : liquorItems

  function selectInventoryItem(item: InventoryItem) {
    // NOTE: 카운터 UI에는 입금가(store_price)를 직접 노출하지 않는다.
    // 다만 `sale_price >= store_price` 가드를 위해 store_price를
    // form.unit_price에 internal state로 보관한다 (화면에 렌더링하지 않음).
    // 실장은 판매가(sale_price)만 입력/수정한다.
    //
    // UI 변경 — 선택 시 기본 판매가를 store_price로 자동 채운다. 운영자는
    // ± 10,000원 버튼으로 조정하며 필요 시 직접 타이핑도 가능하다.
    const storePrice = item.store_price ?? item.unit_cost ?? 0
    onSetForm(() => ({
      ...form,
      item_name: item.name,
      unit_price: storePrice,
      sale_price: storePrice,
      inventory_item_id: item.id,
    }))
    setPickerOpen(false)
    setPickerSearch("")
  }

  function switchTab(value: string) {
    // Only switch the active order_type — preserve form fields for the current tab
    // so data isn't lost when switching between tabs.
    onSetForm(prev => ({
      ...prev,
      order_type: value,
    }))
    setPickerSearch("")
    setPickerOpen(false)
  }

  const orderType = form.order_type
  // Minimum-price guard for liquor orders. form.unit_price holds store_price internally.
  const liquorMinPrice = orderType === "주류" ? form.unit_price : 0
  const liquorSale = form.sale_price ?? 0
  const liquorBelowMin = orderType === "주류" && !!form.item_name && liquorSale > 0 && liquorSale < liquorMinPrice
  const isRoomFeeBase = orderType === "room_fee_base"
  const isRoomFeeExtra = orderType === "room_fee_extra"
  const canAdd = orderType === "웨이터팁" || isRoomFeeBase
    ? form.unit_price > 0
    : isRoomFeeExtra
      ? (form.sale_price ?? 0) > 0
      : orderType === "주류"
        ? !!form.item_name && liquorSale >= liquorMinPrice && liquorSale > 0
        : !!form.item_name && form.unit_price > 0

  return (
    <div className="border-t border-white/10 px-4 py-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-semibold">주문</span>
          {orders.length > 0 ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold">
              {orders.length}건 {fmtWon(orderTotal)}
            </span>
          ) : (
            <span className="text-[10px] text-slate-600">없음</span>
          )}
        </div>
      </div>

      {/* Order list — 주류 orders with the same item_name are collapsed into one
          display row. Quantity/amount are summed, the [+] button creates a new DB
          row (preserves stock decrement + price validation) which then merges into
          the same display group, and [×] deletes the most recent DB row in the
          group (reduces visible qty by 1). Non-liquor orders render unchanged. */}
      {orders.length > 0 && (() => {
        type Entry =
          | { kind: "single"; o: Order }
          | { kind: "liquor-group"; name: string; qty: number; amount: number; rows: Order[] }
        const entries: Entry[] = []
        const liquorIndex = new Map<string, number>()
        for (const o of orders) {
          if (o.order_type === "주류") {
            const key = o.item_name
            const idx = liquorIndex.get(key)
            if (idx !== undefined) {
              const grp = entries[idx] as Extract<Entry, { kind: "liquor-group" }>
              grp.qty += o.qty
              grp.amount += o.amount
              grp.rows.push(o)
            } else {
              liquorIndex.set(key, entries.length)
              entries.push({ kind: "liquor-group", name: o.item_name, qty: o.qty, amount: o.amount, rows: [o] })
            }
          } else {
            entries.push({ kind: "single", o })
          }
        }
        return (
          <div className={`space-y-0.5 mb-1.5 ${entries.length > 5 ? "max-h-[140px] overflow-y-auto overscroll-contain pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded" : ""}`}>
            {entries.map((e, i) => {
              if (e.kind === "single") {
                const o = e.o
                return (
                  <div key={o.id} className="flex items-center gap-1.5 py-1 text-[11px] group">
                    <span className={`text-[9px] px-1 py-px rounded font-medium flex-shrink-0 ${typeColor(o.order_type)}`}>
                      {typeLabel(o.order_type)}
                    </span>
                    <span className="flex-1 truncate text-slate-200">{o.item_name}</span>
                    {o.qty > 1 && <span className="text-slate-500 flex-shrink-0">x{o.qty}</span>}
                    <span className="font-semibold w-[4.5rem] text-right flex-shrink-0">{fmtWon(o.amount)}</span>
                    <button
                      onClick={() => onDelete(o.id)}
                      className="text-slate-600 hover:text-red-400 text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >&#x2715;</button>
                  </div>
                )
              }
              // liquor-group
              const latest = e.rows[e.rows.length - 1]
              return (
                <div key={`liquor:${e.name}:${i}`} className="flex items-center gap-1.5 py-1 text-[11px] group">
                  <span className={`text-[9px] px-1 py-px rounded font-medium flex-shrink-0 ${typeColor("주류")}`}>
                    {typeLabel("주류")}
                  </span>
                  <span className="flex-1 truncate text-slate-200">{e.name}</span>
                  <span className="text-slate-300 flex-shrink-0">{e.qty}병</span>
                  <span className="font-semibold w-[4.5rem] text-right flex-shrink-0">{fmtWon(e.amount)}</span>
                  <button
                    onClick={() => onQuickRepeat(latest)}
                    disabled={busy}
                    title="1병 더 추가"
                    className="h-5 px-1.5 rounded bg-cyan-500/20 border border-cyan-500/30 text-cyan-200 text-[11px] font-bold flex-shrink-0 hover:bg-cyan-500/35 active:scale-95 transition-all disabled:opacity-40"
                  >+</button>
                  <button
                    onClick={() => onDelete(latest.id)}
                    className="text-slate-600 hover:text-red-400 text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="최근 1병 제거"
                  >&#x2715;</button>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Add order form */}
      {formOpen && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5 max-w-[480px] mx-auto">
          {/* Order type tabs */}
          <div className="flex gap-0.5 mx-auto w-full">
            {ORDER_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => switchTab(t.value)}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-semibold whitespace-nowrap text-center transition-all ${
                  form.order_type === t.value
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "bg-white/5 text-slate-400 border border-white/[0.06] hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ━━━ 주류: 메뉴 선택 강제 (수기입력 금지) ━━━ */}
          {orderType === "주류" && (
            <div className="space-y-2">
              {liquorItems.length > 0 ? (
                <>
                  {/* Menu selector */}
                  <div className="relative" ref={pickerRef}>
                    <button
                      onClick={() => setPickerOpen(v => !v)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-all ${
                        form.item_name
                          ? "bg-cyan-500/10 border border-cyan-500/30 text-white"
                          : "bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      <span className={form.item_name ? "font-medium" : ""}>
                        {form.item_name || "주류 메뉴 선택..."}
                      </span>
                      <span className="text-slate-500 text-[10px]">▼</span>
                    </button>

                    {pickerOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#0d1020] border border-white/15 rounded-lg shadow-xl max-h-[200px] overflow-hidden flex flex-col">
                        <div className="p-2 border-b border-white/10">
                          <input
                            ref={searchRef}
                            value={pickerSearch}
                            onChange={e => setPickerSearch(e.target.value)}
                            placeholder="메뉴 검색..."
                            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                          />
                        </div>
                        <div className="overflow-y-auto flex-1">
                          {filteredItems.length === 0 ? (
                            <div className="py-3 text-center text-slate-500 text-[11px]">검색 결과 없음</div>
                          ) : (
                            filteredItems.map(item => (
                              <button
                                key={item.id}
                                onClick={() => selectInventoryItem(item)}
                                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left"
                              >
                                <span className="text-white font-medium">{item.name}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`text-[10px] ${item.is_out_of_stock ? "text-red-400" : item.is_low_stock ? "text-amber-400" : "text-slate-500"}`}>
                                    {item.current_stock}{item.unit}
                                  </span>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Selected item display: qty + inline-edit sale price + quick-add (+) */}
                  {form.item_name && (
                    <div className="space-y-1.5">
                      <div className="flex items-end gap-2">
                        <div className="w-14">
                          <label className="text-[10px] text-slate-500 mb-0.5 block">수량</label>
                          <input
                            type="number" min={1} value={form.qty}
                            onChange={e => onSetForm(f => ({ ...f, qty: Math.max(1, Number(e.target.value)) }))}
                            className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-cyan-400 mb-0.5 block">판매가 (± 10,000)</label>
                          <div className="flex items-stretch gap-1">
                            <button
                              type="button"
                              onClick={() => onSetForm(f => ({ ...f, sale_price: Math.max(0, (f.sale_price ?? 0) - 10000) }))}
                              disabled={(liquorSale ?? 0) <= 0}
                              className="w-8 rounded-md bg-white/5 border border-white/10 text-cyan-200 text-base font-bold hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="10,000원 감소"
                            >−</button>
                            <input
                              type="number" min={0} step={10000} value={liquorSale || ""}
                              onChange={e => onSetForm(f => ({ ...f, sale_price: Math.max(0, Number(e.target.value)) }))}
                              className={`flex-1 bg-white/5 rounded-md px-2.5 py-2 text-xs text-center outline-none ${
                                liquorBelowMin
                                  ? "border border-red-500/40 text-red-300 focus:border-red-500/60"
                                  : "border border-cyan-500/20 text-cyan-200 focus:border-cyan-500/50"
                              }`}
                              placeholder="판매가"
                            />
                            <button
                              type="button"
                              onClick={() => onSetForm(f => ({ ...f, sale_price: Math.max(0, (f.sale_price ?? 0) + 10000) }))}
                              className="w-8 rounded-md bg-white/5 border border-white/10 text-cyan-200 text-base font-bold hover:bg-white/10 active:scale-95"
                              title="10,000원 증가"
                            >+</button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={onAdd}
                          disabled={busy || !canAdd}
                          title="주문 추가"
                          className="h-[34px] px-3 rounded-md bg-cyan-500/25 border border-cyan-500/50 text-cyan-100 text-base font-bold hover:bg-cyan-500/40 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >+</button>
                      </div>
                      {liquorBelowMin && (
                        <div className="text-[10px] text-red-300 px-1">
                          설정된 최소 단가보다 낮게 판매할 수 없습니다. 최소 판매가: {fmtWon(liquorMinPrice)}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                /* No liquor menu registered — block input */
                <div className="py-4 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">등록된 주류 메뉴 없음</div>
                  <div className="text-[10px] text-slate-500">재고 관리에서 주류 품목을 먼저 등록하세요</div>
                </div>
              )}
            </div>
          )}

          {/* ━━━ 웨이터팁: 프리셋 + 직접입력 ━━━ */}
          {orderType === "웨이터팁" && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {TIP_PRESETS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => onSetForm(f => ({ ...f, item_name: "웨이터팁", unit_price: amt, qty: 1 }))}
                    className={`py-2 rounded-md text-xs font-semibold transition-all ${
                      form.unit_price === amt && form.item_name === "웨이터팁"
                        ? "bg-purple-500/25 text-purple-200 border border-purple-500/40"
                        : "bg-white/5 text-slate-300 border border-white/[0.08] hover:bg-white/10"
                    }`}
                  >
                    {fmtWon(amt)}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">직접 입력 (원)</label>
                <input
                  type="number" min={0} step={1000}
                  value={form.unit_price}
                  onChange={e => onSetForm(f => ({ ...f, item_name: "웨이터팁", unit_price: Math.max(0, Number(e.target.value)), qty: 1 }))}
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
          )}

          {/* ━━━ 룸티: 프리셋 + 직접입력 — store_price = sale_price (매장 수익) ━━━ */}
          {orderType === "room_fee_base" && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {ROOM_FEE_PRESETS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => onSetForm(f => ({ ...f, item_name: "룸티", unit_price: amt, qty: 1 }))}
                    className={`py-2 rounded-md text-xs font-semibold transition-all ${
                      form.unit_price === amt && form.item_name === "룸티"
                        ? "bg-cyan-500/25 text-cyan-200 border border-cyan-500/40"
                        : "bg-white/5 text-slate-300 border border-white/[0.08] hover:bg-white/10"
                    }`}
                  >
                    {fmtWon(amt)}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">직접 입력 (원)</label>
                <input
                  type="number" min={0} step={10000}
                  value={form.unit_price}
                  onChange={e => onSetForm(f => ({ ...f, item_name: "룸티", unit_price: Math.max(0, Number(e.target.value)), qty: 1 }))}
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="text-[9px] text-cyan-400/60 px-1">룸티 — 판매가 + 입금가로 가게 매출에 반영됩니다.</div>
            </div>
          )}

          {/* ━━━ 룸티연장: 프리셋 + 직접입력 — store_price = 0 (실장 수익만) ━━━ */}
          {orderType === "room_fee_extra" && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {ROOM_FEE_PRESETS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => onSetForm(f => ({ ...f, item_name: "룸티연장", unit_price: 0, sale_price: amt, qty: 1 }))}
                    className={`py-2 rounded-md text-xs font-semibold transition-all ${
                      (form.sale_price ?? 0) === amt && form.item_name === "룸티연장"
                        ? "bg-teal-500/25 text-teal-200 border border-teal-500/40"
                        : "bg-white/5 text-slate-300 border border-white/[0.08] hover:bg-white/10"
                    }`}
                  >
                    {fmtWon(amt)}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">직접 입력 (원)</label>
                <input
                  type="number" min={0} step={10000}
                  value={form.sale_price ?? 0}
                  onChange={e => onSetForm(f => ({ ...f, item_name: "룸티연장", unit_price: 0, sale_price: Math.max(0, Number(e.target.value)), qty: 1 }))}
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="text-[9px] text-teal-400/60 px-1">룸티연장 — 판매가만 반영, 실장 수익으로 처리됩니다.</div>
            </div>
          )}

          {/* ━━━ 사입: 품목명 + 금액 (1줄, 수량 없음) ━━━ */}
          {orderType === "사입" && (
            <div className="flex gap-1.5 items-end">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-slate-500 mb-0.5 block">품목</label>
                <input
                  value={form.item_name}
                  onChange={e => onSetForm(f => ({ ...f, item_name: e.target.value, qty: 1 }))}
                  placeholder="사입 품목명"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <div className="w-28 flex-shrink-0">
                <label className="text-[10px] text-slate-500 mb-0.5 block">금액 (원)</label>
                <input
                  type="number" min={0} step={1000} value={form.unit_price}
                  onChange={e => onSetForm(f => ({ ...f, unit_price: Math.max(0, Number(e.target.value)), qty: 1 }))}
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
          )}

          {/* ━━━ 기타: 메모 + 금액 ━━━ */}
          {orderType === "기타" && (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">항목 메모</label>
                <input
                  value={form.item_name}
                  onChange={e => onSetForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder="항목 설명 (예: 꽃바구니, 이벤트비)"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">수량</label>
                  <input
                    type="number" min={1} value={form.qty}
                    onChange={e => onSetForm(f => ({ ...f, qty: Math.max(1, Number(e.target.value)) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">금액 (원)</label>
                  <input
                    type="number" min={0} step={1000} value={form.unit_price}
                    onChange={e => onSetForm(f => ({ ...f, unit_price: Math.max(0, Number(e.target.value)) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-xs outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Preview + actions (shared) */}
          <div className="flex items-center justify-between pt-0.5">
            {form.unit_price > 0 && form.qty > 0 && (
              <span className="text-[11px] text-slate-400">
                합계: <span className="text-white font-semibold">{fmtWon(form.unit_price * form.qty)}</span>
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => onSetFormOpen(false)}
                className="px-4 py-1.5 rounded-md bg-white/5 text-slate-300 text-xs hover:bg-white/10 transition-colors"
              >취소</button>
              <button
                onClick={onAdd}
                disabled={busy || !canAdd}
                className="px-4 py-1.5 rounded-md bg-cyan-500/80 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-500 transition-colors"
              >추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
