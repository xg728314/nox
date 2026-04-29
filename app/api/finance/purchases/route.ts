import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * /api/finance/purchases — owner only.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...
 * POST { business_date, category, item_name, unit_price_won, qty, vendor?, memo?, receipt_url? }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_CATEGORIES = new Set(["liquor", "soju", "beer", "wine", "fruit", "other"])

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    const category = url.searchParams.get("category")

    const supabase = supa()
    let query = supabase
      .from("store_purchases")
      .select("id, business_date, category, item_name, unit_price_won, qty, total_won, vendor, memo, receipt_url, status, created_by, created_at")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .limit(500)
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("business_date", from)
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("business_date", to)
    if (category && VALID_CATEGORIES.has(category)) query = query.eq("category", category)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      business_date?: unknown
      category?: unknown
      item_name?: unknown
      unit_price_won?: unknown
      qty?: unknown
      vendor?: unknown
      memo?: unknown
      receipt_url?: unknown
      inventory_item_id?: unknown
    }

    const business_date = String(body.business_date ?? "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "business_date YYYY-MM-DD" }, { status: 400 })
    }
    const category = String(body.category ?? "")
    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "category invalid" }, { status: 400 })
    }
    const item_name = String(body.item_name ?? "").trim()
    if (!item_name) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "item_name required" }, { status: 400 })
    }
    const unit_price_won = Math.max(0, Number(body.unit_price_won) || 0)
    const qty = Math.max(1, Math.floor(Number(body.qty) || 1))
    const total_won = unit_price_won * qty
    if (total_won <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "total must be > 0" }, { status: 400 })
    }
    const vendor = typeof body.vendor === "string" ? body.vendor.trim() || null : null
    const memo = typeof body.memo === "string" ? body.memo.trim() || null : null
    const receipt_url = typeof body.receipt_url === "string" ? body.receipt_url.trim() || null : null
    const inventory_item_id = typeof body.inventory_item_id === "string" && /^[0-9a-f-]{36}$/.test(body.inventory_item_id)
      ? body.inventory_item_id : null

    const supabase = supa()

    // business_day_id best-effort lookup
    let business_day_id: string | null = null
    try {
      const { data: bd } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_date", business_date)
        .maybeSingle()
      business_day_id = (bd as { id?: string } | null)?.id ?? null
    } catch { /* noop */ }

    const { data: row, error } = await supabase
      .from("store_purchases")
      .insert({
        store_uuid: auth.store_uuid,
        business_day_id,
        business_date,
        category,
        item_name,
        unit_price_won,
        qty,
        total_won,
        vendor,
        memo,
        receipt_url,
        inventory_item_id,
        status: "approved",
        created_by: auth.user_id,
        approved_by: auth.user_id,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) {
      return NextResponse.json({ error: "DB_INSERT_FAILED", message: error.message }, { status: 500 })
    }
    const id = (row as { id: string }).id

    await logAuditEvent(supabase, {
      auth,
      action: "store_purchase_created",
      entity_table: "store_purchases",
      entity_id: id,
      status: "success",
      metadata: { category, item_name, unit_price_won, qty, total_won, vendor },
    }).catch(() => { /* audit best-effort — purchases 는 변동비 ledger, 손실 시에도 PnL 합산은 유효 */ })

    return NextResponse.json({ id, total_won })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
