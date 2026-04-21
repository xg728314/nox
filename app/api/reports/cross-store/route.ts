import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-016: GET /api/reports/cross-store
 *
 * Cross-store rollup grouped by target store (to_store_uuid).
 * Aggregation only. Owner-only.
 *
 * For each target store:
 *   total_amount, paid_amount (prepaid_amount), remaining_amount,
 *   open / partial / completed counts, header_count.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    const { data: headersRaw } = await supabase
      .from("cross_store_settlements")
      .select("id, to_store_uuid, status, total_amount, prepaid_amount, remaining_amount")
      .eq("from_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(2000)
    const headers = (headersRaw ?? []) as Array<{
      id: string
      to_store_uuid: string
      status: string
      total_amount: number | string
      prepaid_amount: number | string
      remaining_amount: number | string
    }>

    type Group = {
      to_store_uuid: string
      store_name: string
      header_count: number
      total_amount: number
      paid_amount: number
      remaining_amount: number
      open_count: number
      partial_count: number
      completed_count: number
    }
    const groups = new Map<string, Group>()
    for (const h of headers) {
      if (!h.to_store_uuid) continue
      if (!groups.has(h.to_store_uuid)) {
        groups.set(h.to_store_uuid, {
          to_store_uuid: h.to_store_uuid,
          store_name: h.to_store_uuid.slice(0, 8),
          header_count: 0,
          total_amount: 0,
          paid_amount: 0,
          remaining_amount: 0,
          open_count: 0,
          partial_count: 0,
          completed_count: 0,
        })
      }
      const g = groups.get(h.to_store_uuid)!
      g.header_count += 1
      g.total_amount += num(h.total_amount)
      g.paid_amount += num(h.prepaid_amount)
      g.remaining_amount += num(h.remaining_amount)
      if (h.status === "open") g.open_count += 1
      else if (h.status === "partial") g.partial_count += 1
      else if (h.status === "completed") g.completed_count += 1
    }

    const storeIds = Array.from(groups.keys())
    if (storeIds.length > 0) {
      const { data: sRaw } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", storeIds)
      for (const s of (sRaw ?? []) as Array<{ id: string; store_name: string | null }>) {
        const g = groups.get(s.id)
        if (g && s.store_name) g.store_name = s.store_name
      }
    }

    const stores = Array.from(groups.values()).sort((a, b) => b.remaining_amount - a.remaining_amount)
    return NextResponse.json({ stores })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
