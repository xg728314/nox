import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * /api/finance/purchases — owner only.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...
 * POST { business_date, category, item_name, unit_price_won, qty,
 *        memo?, receipt_url?, inventory_item_id? }
 *
 * 2026-04-29 v2: 재고 자동 연동.
 *   inventory_item_id 가 주어지면:
 *     1) inventory_items 룩업 + units_per_box 추출 (없으면 1)
 *     2) increment_stock RPC 로 current_stock 을 (qty × units_per_box) 만큼
 *        원자적으로 증가
 *     3) inventory_transactions 에 type='in' row 기록 (감사/이력)
 *   inventory_item_id 미제공 시:
 *     기존과 동일 — store_purchases 만 기록 (변동비 인식만).
 *
 * vendor 컬럼은 유지하되 폼에서 제거 — POST body 가 보내지 않으므로
 * 항상 null 로 저장.
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
      .select("id, business_date, category, item_name, unit_price_won, qty, total_won, vendor, memo, receipt_url, status, created_by, created_at, inventory_item_id")
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
    const memo = typeof body.memo === "string" ? body.memo.trim() || null : null
    const receipt_url = typeof body.receipt_url === "string" ? body.receipt_url.trim() || null : null
    const inventory_item_id = typeof body.inventory_item_id === "string" && /^[0-9a-f-]{36}$/i.test(body.inventory_item_id)
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

    // ── 재고 연동 (선택) ────────────────────────────────────────
    //   inventory_item_id 가 있으면 사전에 메타 (units_per_box, unit, name)
    //   를 읽고 store 매칭 검증. 검증 실패 시 매입 등록 자체를 막아
    //   사일런트 misroute 방지.
    let inventoryMeta: {
      id: string
      name: string
      unit: string
      units_per_box: number
      unit_cost: number
    } | null = null
    let stockUnitsToAdd = 0

    if (inventory_item_id) {
      const { data: invRow, error: invErr } = await supabase
        .from("inventory_items")
        .select("id, name, unit, units_per_box, unit_cost, store_uuid")
        .eq("id", inventory_item_id)
        .is("deleted_at", null)
        .maybeSingle()
      if (invErr || !invRow) {
        return NextResponse.json(
          { error: "INVENTORY_ITEM_NOT_FOUND", message: "재고 품목을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
      const it = invRow as {
        id: string; name: string; unit: string;
        units_per_box: number | null; unit_cost: number | null; store_uuid: string;
      }
      if (it.store_uuid !== auth.store_uuid) {
        return NextResponse.json(
          { error: "ROLE_FORBIDDEN", message: "다른 매장의 재고 품목입니다." },
          { status: 403 },
        )
      }
      const upb = Math.max(1, it.units_per_box ?? 1)
      inventoryMeta = {
        id: it.id,
        name: it.name,
        unit: it.unit,
        units_per_box: upb,
        unit_cost: it.unit_cost ?? 0,
      }
      stockUnitsToAdd = qty * upb
    }

    // ── store_purchases insert ────────────────────────────────
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
        vendor: null,
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

    // ── 재고 증가 RPC + transaction 기록 ────────────────────────
    //   store_purchases insert 가 성공한 후에만 진행. RPC 실패 시
    //   purchase 는 남고 재고는 미반영 — error 응답으로 운영자에게
    //   불일치 사실 통지.
    let stockResult: { before: number; after: number } | null = null
    if (inventoryMeta && stockUnitsToAdd > 0) {
      const { data: incRows, error: incErr } = await supabase.rpc("increment_stock", {
        p_item_id: inventoryMeta.id,
        p_store_uuid: auth.store_uuid,
        p_qty: stockUnitsToAdd,
      })
      const incRow = (incRows as Array<{ success: boolean; before_stock: number; after_stock: number }> | null)?.[0]
      if (incErr || !incRow || !incRow.success) {
        // 재고 증가 실패 → purchase 는 이미 저장됨. fail-soft 응답에 표시.
        return NextResponse.json(
          {
            id,
            total_won,
            stock_synced: false,
            warning: "INVENTORY_INCREMENT_FAILED",
            message: incErr?.message || "재고 자동 증가에 실패했습니다. 재고 화면에서 수동 조정 필요.",
          },
          { status: 200 },
        )
      }
      stockResult = { before: incRow.before_stock, after: incRow.after_stock }

      // inventory_transactions 기록 — total_cost 는 박스 단가 × 박스수
      // (= unit_price_won × qty = total_won). unit_cost 는 박스 1개당 원가
      // (= unit_price_won) 으로 고정해 박스/병 의미 혼선을 차단.
      await supabase.from("inventory_transactions").insert({
        store_uuid: auth.store_uuid,
        item_id: inventoryMeta.id,
        type: "in",
        quantity: stockUnitsToAdd,
        before_stock: stockResult.before,
        after_stock: stockResult.after,
        unit_cost: unit_price_won,
        total_cost: total_won,
        memo: `매입 ${item_name} (qty ${qty} 박스 × ${inventoryMeta.units_per_box} ${inventoryMeta.unit})`,
        actor_membership_id: auth.membership_id,
        business_day_id,
      }).then(() => { /* 기록 실패해도 재고/매입 자체는 성공 — fire-and-forget */ })
    }

    await logAuditEvent(supabase, {
      auth,
      action: "store_purchase_created",
      entity_table: "store_purchases",
      entity_id: id,
      status: "success",
      metadata: {
        category, item_name, unit_price_won, qty, total_won,
        inventory_item_id,
        stock_units_added: stockUnitsToAdd,
        stock_after: stockResult?.after ?? null,
      },
    }).catch(() => { /* best-effort */ })

    return NextResponse.json({
      id,
      total_won,
      stock_synced: !!stockResult,
      stock_before: stockResult?.before ?? null,
      stock_after: stockResult?.after ?? null,
      stock_units_added: stockUnitsToAdd,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
