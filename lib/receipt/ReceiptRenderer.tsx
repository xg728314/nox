"use client"

import type { ReceiptDocument } from "./types"

/**
 * ReceiptRenderer — single shared component for Preview & Print.
 * Consumes ReceiptDocument snapshot only. NO recalculation inside.
 *
 * Modes:
 * - "preview" — dark overlay, scrollable
 * - "print"  — white background, print-friendly, no buttons
 * - "png"    — same as print but sized for canvas capture
 */

type Props = {
  doc: ReceiptDocument
  mode?: "preview" | "print" | "png"
}

function fmt(v: number): string {
  return v.toLocaleString() + "\uC6D0"
}

function fmtTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`
}

export default function ReceiptRenderer({ doc, mode = "preview" }: Props) {
  const isPrint = mode === "print" || mode === "png"

  // Classify orders by type
  const liquorOrders = doc.orders.filter(o => ["\uC8FC\uB958", "\uC591\uC8FC", "liquor"].includes(o.order_type))
  const waiterTipOrders = doc.orders.filter(o => ["\uC6E8\uC774\uD130\uD301", "waiter_tip"].includes(o.order_type))
  const otherOrders = doc.orders.filter(o =>
    !["\uC8FC\uB958", "\uC591\uC8FC", "liquor", "\uC6E8\uC774\uD130\uD301", "waiter_tip", "\uC0AC\uC785", "purchase"].includes(o.order_type)
  )

  const liquorTotal = liquorOrders.reduce((s, o) => s + o.amount, 0)
  const waiterTipTotal = waiterTipOrders.reduce((s, o) => s + o.amount, 0)
  const otherTotal = otherOrders.reduce((s, o) => s + o.amount, 0)

  // Group liquor orders by item_name so identical bottles appear as one summed row.
  // Only the display is aggregated — liquorTotal and settlement math use raw rows.
  type LiquorGroup = { name: string; qty: number; amount: number }
  const liquorGroups: LiquorGroup[] = (() => {
    const map = new Map<string, LiquorGroup>()
    for (const o of liquorOrders) {
      const g = map.get(o.item_name)
      if (g) { g.qty += o.qty; g.amount += o.amount }
      else map.set(o.item_name, { name: o.item_name, qty: o.qty, amount: o.amount })
    }
    return Array.from(map.values())
  })()

  const receiptLabel = doc.receipt_type === "interim" ? "\uC911\uAC04 \uACC4\uC0B0\uC11C" : "\uCD5C\uC885 \uACC4\uC0B0\uC11C"

  return (
    <div className={isPrint ? "bg-white text-gray-900" : "bg-white text-gray-900 rounded-xl shadow-2xl w-[360px] max-w-[92vw]"}>
      <div className={`max-w-[320px] mx-auto ${isPrint ? "px-4 py-6" : "px-6 py-8"}`}>
        {/* Header — 매장명 / 계산서 타입 / 방번호 만 표시 */}
        <div className="text-center border-b-2 border-gray-900 pb-3 mb-4">
          <h1 className="text-xl font-bold tracking-wide">{doc.store_name || "\u00A0"}</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">{receiptLabel}</p>
          {doc.room_label && (
            <p className="text-sm text-gray-600 mt-1">{doc.room_label}</p>
          )}
        </div>

        {/* Liquor section — group by item_name */}
        {liquorGroups.length > 0 && (
          <Section title="LIQUOR">
            {liquorGroups.map((g, i) => (
              <LineItem key={i} label={g.name} qty={g.qty} amount={g.amount} />
            ))}
            <Subtotal label="양주 소계" amount={liquorTotal} />
          </Section>
        )}

        {/* Time section (participants) */}
        {doc.participants.length > 0 && (
          <Section title="TIME">
            {doc.participants.filter(p => p.status === "active" || p.status === "mid_out").map((p, i) => (
              <div key={i} className="flex justify-between text-[12px] leading-5">
                <span className="text-gray-700">
                  {p.category || "-"} <span className="text-gray-400">{p.time_minutes}분</span>
                </span>
                <span className="font-medium">{fmt(p.price_amount)}</span>
              </div>
            ))}
            <Subtotal label={`\uD0C0\uC784 \uC18C\uACC4 (${doc.participants.length}\uAC74)`} amount={doc.participant_total} />
          </Section>
        )}

        {/* Waiter tip */}
        {waiterTipTotal > 0 && (
          <Section title="SERVICE">
            {waiterTipOrders.map((o, i) => (
              <LineItem key={i} label={o.item_name || "\uC6E8\uC774\uD130 \uBD09\uC0AC\uBE44"} qty={o.qty} amount={o.amount} />
            ))}
            <Subtotal label="봉사비 소계" amount={waiterTipTotal} />
          </Section>
        )}

        {/* Other orders */}
        {otherOrders.length > 0 && (
          <Section title="OTHER">
            {otherOrders.map((o, i) => (
              <LineItem key={i} label={o.item_name} qty={o.qty} amount={o.amount} />
            ))}
            <Subtotal label="기타 소계" amount={otherTotal} />
          </Section>
        )}

        {/* Card surcharge */}
        {(doc.card_fee_amount ?? 0) > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-[12px] text-gray-500">
              <span>카드수수료</span>
              <span>{fmt(doc.card_fee_amount ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Grand total */}
        <div className="border-t-2 border-gray-900 pt-3 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-base font-bold">TOTAL</span>
            <span className="text-xl font-bold">{fmt(doc.grand_total)}</span>
          </div>
          {doc.payment_method && (
            <div className="text-right mt-0.5">
              <span className="text-[10px] text-gray-400 uppercase">
                {doc.payment_method === "cash" ? "CASH" :
                 doc.payment_method === "card" ? "CARD" :
                 doc.payment_method === "credit" ? "CREDIT" : "MIXED"}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] text-gray-300 border-t border-gray-200 pt-3">
          {doc.is_reprint && (
            <p className="text-gray-400 font-semibold mb-0.5">--- RE-PRINT ---</p>
          )}
          <p>{fmtDate(doc.created_at)} {fmtTime(doc.created_at)}</p>
          <p className="mt-0.5">Thank you for visiting NOX</p>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components (private) ─────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{title}</h2>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function LineItem({ label, qty, amount }: { label: string; qty: number; amount: number }) {
  return (
    <div className="flex justify-between text-[12px] leading-5">
      <span className="text-gray-700 truncate max-w-[60%]">
        {label}
        {qty > 1 && <span className="text-gray-400 ml-1">x{qty}</span>}
      </span>
      <span className="font-medium flex-shrink-0">{fmt(amount)}</span>
    </div>
  )
}

function Subtotal({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between text-[12px] font-semibold mt-1.5 pt-1.5 border-t border-gray-200">
      <span>{label}</span>
      <span>{fmt(amount)}</span>
    </div>
  )
}
