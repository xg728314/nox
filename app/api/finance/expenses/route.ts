import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * /api/finance/expenses — owner only.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...
 * POST { business_date, category, amount_won, description?, memo?, receipt_url? }
 *
 * store_expenses 는 일반 일별 지출.
 *   2026-04-29 v2: category 자유 입력 (월세/카드값/공과금/잡비 등 운영자 임의 라벨).
 *     migration 103 으로 enum CHECK 제약 제거 — length>0 만 강제.
 *   고정비 (정기 월세/공과금/잡비) 는 store_settings.monthly_* 에 별도.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 안전한 길이 상한 (악의적/오타 매우 긴 라벨 방지). */
const CATEGORY_MAX_LEN = 40

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
    const category = (url.searchParams.get("category") || "").trim()

    const supabase = supa()
    let query = supabase
      .from("store_expenses")
      .select("id, business_date, category, amount_won, description, memo, receipt_url, status, created_by, created_at")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .limit(500)
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("business_date", from)
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("business_date", to)
    if (category && category.length <= CATEGORY_MAX_LEN) query = query.eq("category", category)

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
      amount_won?: unknown
      description?: unknown
      memo?: unknown
      receipt_url?: unknown
    }

    const business_date = String(body.business_date ?? "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "business_date YYYY-MM-DD" }, { status: 400 })
    }
    const category = String(body.category ?? "").trim()
    if (!category) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "category required" }, { status: 400 })
    }
    if (category.length > CATEGORY_MAX_LEN) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `category too long (max ${CATEGORY_MAX_LEN})` }, { status: 400 })
    }
    const amount_won = Math.max(0, Math.floor(Number(body.amount_won) || 0))
    if (amount_won <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be > 0" }, { status: 400 })
    }
    const description = typeof body.description === "string" ? body.description.trim() || null : null
    const memo = typeof body.memo === "string" ? body.memo.trim() || null : null
    const receipt_url = typeof body.receipt_url === "string" ? body.receipt_url.trim() || null : null

    const supabase = supa()

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
      .from("store_expenses")
      .insert({
        store_uuid: auth.store_uuid,
        business_day_id,
        business_date,
        category,
        amount_won,
        description,
        memo,
        receipt_url,
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
      action: "store_expense_created",
      entity_table: "store_expenses",
      entity_id: id,
      status: "success",
      metadata: { category, amount_won, description },
    }).catch(() => { /* best-effort */ })

    return NextResponse.json({ id, amount_won })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
