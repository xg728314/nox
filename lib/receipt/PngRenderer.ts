/**
 * PngRenderer — generates POS-compatible PNG from ReceiptDocument.
 * Fixed width (384px = standard 80mm POS thermal printer at 203 DPI).
 * Uses Canvas 2D text rendering. Consumes snapshot only — NO recalculation.
 */

import type { ReceiptDocument } from "./types"

const WIDTH = 384
const PADDING = 16
const CONTENT_W = WIDTH - PADDING * 2
const FONT_FAMILY = "'Noto Sans KR', 'Malgun Gothic', sans-serif"

type DrawCtx = {
  ctx: CanvasRenderingContext2D
  y: number
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

function drawCenter(d: DrawCtx, text: string, fontSize: number, bold = false) {
  d.ctx.font = `${bold ? "bold " : ""}${fontSize}px ${FONT_FAMILY}`
  d.ctx.textAlign = "center"
  d.ctx.fillText(text, WIDTH / 2, d.y)
  d.y += fontSize + 4
}

function drawRow(d: DrawCtx, left: string, right: string, fontSize: number, bold = false) {
  d.ctx.font = `${bold ? "bold " : ""}${fontSize}px ${FONT_FAMILY}`
  d.ctx.textAlign = "left"
  // Truncate left text if too wide
  const rightW = d.ctx.measureText(right).width
  const maxLeftW = CONTENT_W - rightW - 8
  let truncLeft = left
  while (d.ctx.measureText(truncLeft).width > maxLeftW && truncLeft.length > 1) {
    truncLeft = truncLeft.slice(0, -1)
  }
  if (truncLeft !== left) truncLeft += ".."
  d.ctx.fillText(truncLeft, PADDING, d.y)
  d.ctx.textAlign = "right"
  d.ctx.fillText(right, WIDTH - PADDING, d.y)
  d.y += fontSize + 3
}

function drawLine(d: DrawCtx, thick = false) {
  d.ctx.strokeStyle = thick ? "#111" : "#ccc"
  d.ctx.lineWidth = thick ? 2 : 1
  d.ctx.beginPath()
  d.ctx.moveTo(PADDING, d.y)
  d.ctx.lineTo(WIDTH - PADDING, d.y)
  d.ctx.stroke()
  d.y += thick ? 6 : 4
}

function drawSpacer(d: DrawCtx, h = 8) {
  d.y += h
}

export function renderReceiptPng(doc: ReceiptDocument): HTMLCanvasElement {
  // Classify orders (same logic as ReceiptRenderer)
  const liquorOrders = doc.orders.filter(o => ["\uC8FC\uB958", "\uC591\uC8FC", "liquor"].includes(o.order_type))
  const waiterTipOrders = doc.orders.filter(o => ["\uC6E8\uC774\uD130\uD301", "waiter_tip"].includes(o.order_type))
  const otherOrders = doc.orders.filter(o =>
    !["\uC8FC\uB958", "\uC591\uC8FC", "liquor", "\uC6E8\uC774\uD130\uD301", "waiter_tip", "\uC0AC\uC785", "purchase"].includes(o.order_type)
  )

  const liquorTotal = liquorOrders.reduce((s, o) => s + o.amount, 0)
  const waiterTipTotal = waiterTipOrders.reduce((s, o) => s + o.amount, 0)

  const receiptLabel = doc.receipt_type === "interim" ? "\uC911\uAC04 \uACC4\uC0B0\uC11C" : "\uCD5C\uC885 \uACC4\uC0B0\uC11C"

  // Create canvas with estimated height (we'll trim later)
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = 2000 // generous initial height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, WIDTH, 2000)
  ctx.fillStyle = "#000"

  const d: DrawCtx = { ctx, y: 24 }

  // ── Header
  drawCenter(d, "NOX", 20, true)
  drawCenter(d, receiptLabel, 10)
  drawCenter(d, doc.room_label, 13)

  const timeStr = `IN ${fmtTime(doc.started_at)}${doc.ended_at ? `  OUT ${fmtTime(doc.ended_at)}` : ""}`
  drawCenter(d, timeStr, 10)

  if (doc.customer_name) {
    drawCenter(d, `${doc.customer_name}${doc.customer_party_size > 0 ? ` ${doc.customer_party_size}\uC778` : ""}`, 10)
  }
  if (doc.manager_name) {
    drawCenter(d, `\uB2F4\uB2F9: ${doc.manager_name}`, 9)
  }

  drawLine(d, true)

  // ── Liquor
  if (liquorOrders.length > 0) {
    drawCenter(d, "LIQUOR", 9)
    drawSpacer(d, 2)
    for (const o of liquorOrders) {
      const label = o.qty > 1 ? `${o.item_name} x${o.qty}` : o.item_name
      drawRow(d, label, fmt(o.amount), 11)
    }
    drawLine(d)
    drawRow(d, "\uC591\uC8FC \uC18C\uACC4", fmt(liquorTotal), 11, true)
    drawSpacer(d)
  }

  // ── Time
  if (doc.participants.length > 0) {
    drawCenter(d, "TIME", 9)
    drawSpacer(d, 2)
    for (const p of doc.participants.filter(p => p.status === "active" || p.status === "mid_out")) {
      drawRow(d, `${p.category || "-"} ${p.time_minutes}\uBD84`, fmt(p.price_amount), 11)
    }
    drawLine(d)
    drawRow(d, `\uD0C0\uC784 \uC18C\uACC4 (${doc.participants.length}\uAC74)`, fmt(doc.participant_total), 11, true)
    drawSpacer(d)
  }

  // ── Waiter tip
  if (waiterTipTotal > 0) {
    drawCenter(d, "SERVICE", 9)
    drawSpacer(d, 2)
    for (const o of waiterTipOrders) {
      drawRow(d, o.item_name || "\uC6E8\uC774\uD130 \uBD09\uC0AC\uBE44", fmt(o.amount), 11)
    }
    drawLine(d)
    drawRow(d, "\uBD09\uC0AC\uBE44 \uC18C\uACC4", fmt(waiterTipTotal), 11, true)
    drawSpacer(d)
  }

  // ── Other
  if (otherOrders.length > 0) {
    drawCenter(d, "OTHER", 9)
    drawSpacer(d, 2)
    for (const o of otherOrders) {
      const label = o.qty > 1 ? `${o.item_name} x${o.qty}` : o.item_name
      drawRow(d, label, fmt(o.amount), 11)
    }
    drawSpacer(d)
  }

  // ── Card fee
  if ((doc.card_fee_amount ?? 0) > 0) {
    drawRow(d, "\uCE74\uB4DC\uC218\uC218\uB8CC", fmt(doc.card_fee_amount ?? 0), 10)
  }

  // ── Grand total
  drawLine(d, true)
  drawRow(d, "TOTAL", fmt(doc.grand_total), 16, true)
  if (doc.payment_method) {
    d.ctx.textAlign = "right"
    d.ctx.font = `9px ${FONT_FAMILY}`
    d.ctx.fillStyle = "#999"
    d.ctx.fillText(
      doc.payment_method === "cash" ? "CASH" :
      doc.payment_method === "card" ? "CARD" :
      doc.payment_method === "credit" ? "CREDIT" : "MIXED",
      WIDTH - PADDING, d.y
    )
    d.y += 12
    d.ctx.fillStyle = "#000"
  }

  drawSpacer(d, 12)
  drawLine(d)

  // ── Footer
  d.ctx.fillStyle = "#aaa"
  if (doc.is_reprint) {
    drawCenter(d, "--- RE-PRINT ---", 9)
  }
  drawCenter(d, `${fmtDate(doc.created_at)} ${fmtTime(doc.created_at)}`, 9)
  drawCenter(d, "Thank you for visiting NOX", 9)

  // Safe zone (bottom padding for POS cutter)
  drawSpacer(d, 24)

  // Trim canvas to actual content height
  const finalHeight = d.y
  const trimmed = document.createElement("canvas")
  trimmed.width = WIDTH
  trimmed.height = finalHeight
  const tCtx = trimmed.getContext("2d")!
  tCtx.drawImage(canvas, 0, 0)

  return trimmed
}

/**
 * Download receipt as PNG file
 */
export function downloadReceiptPng(doc: ReceiptDocument, filename?: string) {
  const canvas = renderReceiptPng(doc)
  const link = document.createElement("a")
  link.download = filename || `receipt_${doc.receipt_type}_${doc.room_label}_${fmtDate(doc.created_at)}.png`
  link.href = canvas.toDataURL("image/png")
  link.click()
}
