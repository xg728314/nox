"use client"

/**
 * /cafe/manage/pos — POS 자동 인쇄 페이지.
 *   - 5초 polling 으로 신규 pending 주문 감지 (이미 출력한 id 는 dedupe)
 *   - 새 주문 발견 → ding 소리 + 인쇄 큐에 추가 → 순서대로 window.print()
 *   - 80mm 영수증 CSS (@page width: 80mm)
 *   - 재인쇄 버튼 (최근 20건)
 *
 * Chrome kiosk 모드 사용 시 인쇄 대화상자 없이 자동 출력:
 *   chrome.exe --kiosk --kiosk-printing http://localhost:3000/cafe/manage/pos
 *
 * 출력 내용:
 *   - 헤더: 카페 이름 / 주문 시각
 *   - 손님 / 위치 / 결제수단
 *   - 메뉴 list (이름 / 옵션 / 수량)
 *   - 메뉴별 레시피 (조리 가이드 + 정보용 라인 + 차감 supply 모두)
 *   - 요청사항 (notes)
 *   - 메뉴 prep_notes (있으면)
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type OrderItem = {
  menu_id: string
  name: string
  price: number
  qty: number
  unit_price?: number
  options?: Array<{ option_id: string; name: string; price_delta: number }>
}
type InboxOrder = {
  id: string
  customer_store_name: string | null
  customer_name: string | null
  delivery_room_name: string | null
  delivery_text: string | null
  payment_method: "account" | "card_on_delivery"
  status: string
  items: OrderItem[]
  subtotal_amount: number
  notes: string | null
  created_at: string
}

type RecipeLine = {
  supply_id: string | null
  supply_name: string | null
  display_name: string | null
  qty: number
  unit: string | null
  supply_unit: string | null
  note: string | null
}
type MenuRecipeBundle = {
  menu_id: string
  menu_name: string
  prep_notes: string | null
  lines: RecipeLine[]
}

function fmt(n: number) { return n.toLocaleString() + "원" }
function timeStr(iso: string) {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`
}

export default function CafePosPrintPage() {
  const [printedIds, setPrintedIds] = useState<Set<string>>(new Set())
  const [recent, setRecent] = useState<InboxOrder[]>([])
  const [printing, setPrinting] = useState<InboxOrder | null>(null)
  const [recipes, setRecipes] = useState<MenuRecipeBundle[]>([])
  const [muted, setMuted] = useState(false)
  const [autoPrint, setAutoPrint] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<InboxOrder[]>([])
  const printingRef = useRef(false)

  // 알림 소리 (data URL beep)
  useEffect(() => {
    const a = new Audio("data:audio/wav;base64,UklGRiQGAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=")
    a.preload = "auto"
    audioRef.current = a
  }, [])

  const playDing = useCallback(() => {
    if (muted) return
    try { audioRef.current?.play() } catch { /* user gesture missing */ }
  }, [muted])

  const fetchOrders = useCallback(async () => {
    try {
      const r = await apiFetch("/api/cafe/orders/inbox?status=pending")
      if (!r.ok) return
      const d = await r.json()
      const orders = (d.orders ?? []) as InboxOrder[]

      // 최근 보관 (재인쇄용)
      setRecent((prev) => {
        const map = new Map<string, InboxOrder>()
        for (const o of [...orders, ...prev]) map.set(o.id, o)
        return Array.from(map.values()).slice(0, 30)
      })

      // 신규 (printedIds 에 없는) 만 큐에 추가
      const fresh = orders.filter((o) => !printedIds.has(o.id))
      if (fresh.length > 0) {
        queueRef.current.push(...fresh)
        playDing()
        // 큐 처리 시작
        processQueue()
      }
    } catch { /* ignore */ }
  }, [printedIds, playDing])

  async function loadRecipes(items: OrderItem[]): Promise<MenuRecipeBundle[]> {
    const ids = Array.from(new Set(items.map((it) => it.menu_id)))
    const results: MenuRecipeBundle[] = []
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await apiFetch(`/api/cafe/menu/${id}/recipes`)
        if (!r.ok) return
        const d = await r.json()
        results.push({
          menu_id: id,
          menu_name: d.menu?.name ?? "",
          prep_notes: d.menu?.prep_notes ?? null,
          lines: d.lines ?? [],
        })
      } catch { /* skip */ }
    }))
    return results
  }

  const processQueue = useCallback(async () => {
    if (printingRef.current) return
    if (queueRef.current.length === 0) return
    printingRef.current = true
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!
      const recs = await loadRecipes(next.items)
      setRecipes(recs)
      setPrinting(next)
      // mark as printed (regardless of result)
      setPrintedIds((prev) => new Set(prev).add(next.id))
      // wait a tick for render
      await new Promise((res) => setTimeout(res, 200))
      if (autoPrint) {
        try { window.print() } catch { /* ignore */ }
      }
      await new Promise((res) => setTimeout(res, 800))
    }
    setPrinting(null)
    setRecipes([])
    printingRef.current = false
  }, [autoPrint])

  useEffect(() => {
    fetchOrders()
    const t = setInterval(fetchOrders, 5000)
    return () => clearInterval(t)
  }, [fetchOrders])

  function reprint(o: InboxOrder) {
    queueRef.current.push(o)
    setPrintedIds((prev) => {
      const next = new Set(prev)
      next.delete(o.id)
      return next
    })
    processQueue()
  }

  return (
    <>
      {/* 화면 (인쇄 시 숨김) */}
      <div className="p-4 print:hidden">
        <div className="max-w-3xl mx-auto space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/cafe/manage" className="text-xs text-cyan-400">← 홈</Link>
              <h1 className="text-lg font-semibold mt-1">🖨️ POS 자동 출력</h1>
              <p className="text-[11px] text-slate-400 mt-1">
                Chrome kiosk-printing 모드 권장: <code className="text-cyan-300">--kiosk --kiosk-printing</code>
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
                자동 출력
              </label>
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
                음소거
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-sm font-semibold mb-2">최근 주문 (재인쇄)</div>
            {recent.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">새 주문 대기 중…</div>
            ) : (
              <div className="space-y-1.5">
                {recent.slice(0, 20).map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded bg-[#030814] border border-white/10 p-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">
                        {o.delivery_room_name
                          ? `${o.customer_store_name} · ${o.delivery_room_name}`
                          : o.delivery_text}
                      </div>
                      <div className="text-slate-500">
                        {timeStr(o.created_at)} · {o.items.length} 메뉴 · {fmt(o.subtotal_amount)}
                      </div>
                    </div>
                    <button onClick={() => reprint(o)}
                      className="text-xs px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200">재인쇄</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 인쇄 영역 (화면에서는 숨김, print 시 보임) */}
      <div className="hidden print:block">
        {printing && <Receipt order={printing} recipes={recipes} />}
      </div>

      {/* 80mm 영수증 print CSS */}
      <style jsx global>{`
        @media print {
          @page { size: 80mm auto; margin: 4mm; }
          html, body { background: white !important; color: black !important; font-family: 'Courier New', monospace; }
          .print-receipt { width: 72mm; font-size: 11pt; line-height: 1.3; }
          .print-receipt h1 { font-size: 14pt; font-weight: bold; text-align: center; margin: 2mm 0; }
          .print-receipt h2 { font-size: 11pt; font-weight: bold; margin: 2mm 0 1mm; }
          .print-receipt hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
          .print-receipt .row { display: flex; justify-content: space-between; }
          .print-receipt .small { font-size: 9pt; }
          .print-receipt .recipe { font-size: 10pt; padding-left: 3mm; }
        }
      `}</style>
    </>
  )
}

// ─── 영수증 (감열지 80mm) ─────────────────────────────────

function Receipt({ order, recipes }: { order: InboxOrder; recipes: MenuRecipeBundle[] }) {
  const recipeByMenu = new Map<string, MenuRecipeBundle>()
  for (const r of recipes) recipeByMenu.set(r.menu_id, r)

  return (
    <div className="print-receipt">
      <h1>☕ 주문 티켓</h1>
      <div className="small" style={{ textAlign: "center" }}>{new Date(order.created_at).toLocaleString("ko-KR")}</div>
      <hr />

      <div className="row"><span>📍 위치</span></div>
      <div>
        {order.delivery_room_name
          ? `${order.customer_store_name ?? ""} · ${order.delivery_room_name}`
          : order.delivery_text}
      </div>
      {order.customer_name && (
        <div className="small">주문자: {order.customer_name}</div>
      )}
      <div className="row small">
        <span>결제: {order.payment_method === "account" ? "계좌입금" : "카드(수령시)"}</span>
        <span>{fmt(order.subtotal_amount)}</span>
      </div>
      <hr />

      <h2>📦 주문 메뉴</h2>
      {order.items.map((it, idx) => {
        const rec = recipeByMenu.get(it.menu_id)
        return (
          <div key={idx} style={{ marginBottom: "3mm" }}>
            <div className="row" style={{ fontWeight: "bold" }}>
              <span>{it.name} × {it.qty}</span>
              <span>{fmt((it.unit_price ?? it.price) * it.qty)}</span>
            </div>
            {it.options && it.options.length > 0 && (
              <div className="small">
                {it.options.map((o) => `+ ${o.name}`).join(", ")}
              </div>
            )}
            {rec && rec.lines.length > 0 && (
              <div className="recipe">
                <div className="small" style={{ fontWeight: "bold", marginTop: "1mm" }}>📋 레시피:</div>
                {rec.lines.map((l, i) => (
                  <div key={i} className="small">
                    • {l.display_name || l.supply_name}{" "}
                    <b>{l.qty}{l.unit || l.supply_unit || ""}</b>
                    {l.note && <span> — {l.note}</span>}
                  </div>
                ))}
                {rec.prep_notes && (
                  <div className="small" style={{ marginTop: "1mm", fontStyle: "italic" }}>
                    ☞ {rec.prep_notes}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {order.notes && (
        <>
          <hr />
          <div><b>요청:</b> {order.notes}</div>
        </>
      )}
      <hr />
      <div className="small" style={{ textAlign: "center" }}>주문 #{order.id.slice(0, 8)}</div>
    </div>
  )
}
