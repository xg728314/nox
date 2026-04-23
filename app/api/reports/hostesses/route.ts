import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-016: GET /api/reports/hostesses
 *
 * Per-hostess rollup for the reports dashboard.
 * Aggregation only — state is derived from stored paid/remaining.
 *
 * Owner-only. Default sort: remaining_amount DESC.
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

function deriveState(paid: number, remaining: number): "confirmed" | "partial" | "paid" {
  if (remaining <= 0 && paid > 0) return "paid"
  if (paid > 0 && remaining > 0) return "partial"
  return "confirmed"
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    const { data: itemsRaw } = await supabase
      .from("settlement_items")
      .select("settlement_id, membership_id, amount, paid_amount, remaining_amount")
      .eq("store_uuid", auth.store_uuid)
      .eq("role_type", "hostess")
      .is("deleted_at", null)
      .limit(5000)
    const items = (itemsRaw ?? []) as Array<{
      settlement_id: string
      membership_id: string | null
      amount: number | string
      paid_amount: number | string
      remaining_amount: number | string
    }>

    const sids = Array.from(new Set(items.map(i => i.settlement_id).filter(Boolean)))
    const statusById: Record<string, string> = {}
    if (sids.length > 0) {
      const { data: srows } = await supabase
        .from("settlements")
        .select("id, status")
        .in("id", sids)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
      for (const s of (srows ?? []) as Array<{ id: string; status: string }>) {
        statusById[s.id] = s.status
      }
    }
    const payable = items.filter(i => ["confirmed", "paid"].includes(statusById[i.settlement_id] ?? ""))

    type Group = {
      membership_id: string
      name: string
      total_amount: number
      paid_amount: number
      remaining_amount: number
      state: "confirmed" | "partial" | "paid"
    }
    const groups = new Map<string, Group>()
    for (const it of payable) {
      const mid = it.membership_id
      if (!mid) continue
      if (!groups.has(mid)) {
        groups.set(mid, {
          membership_id: mid,
          name: mid.slice(0, 8),
          total_amount: 0,
          paid_amount: 0,
          remaining_amount: 0,
          state: "confirmed",
        })
      }
      const g = groups.get(mid)!
      g.total_amount += num(it.amount)
      g.paid_amount += num(it.paid_amount)
      g.remaining_amount += num(it.remaining_amount)
    }
    for (const g of groups.values()) {
      g.state = deriveState(g.paid_amount, g.remaining_amount)
    }

    const mids = Array.from(groups.keys())
    if (mids.length > 0) {
      const { data: memRaw } = await supabase
        .from("store_memberships")
        .select("id, profile_id")
        .in("id", mids)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
      const mems = (memRaw ?? []) as Array<{ id: string; profile_id: string }>
      const pids = mems.map(m => m.profile_id)
      const { data: profRaw } = await supabase
        .from("profiles")
        .select("id, full_name, nickname")
        .in("id", pids)
      const profById: Record<string, { full_name: string | null; nickname: string | null }> = {}
      for (const p of (profRaw ?? []) as Array<{ id: string; full_name: string | null; nickname: string | null }>) {
        profById[p.id] = p
      }
      for (const m of mems) {
        const p = profById[m.profile_id]
        const g = groups.get(m.id)
        if (g) g.name = p?.nickname || p?.full_name || m.id.slice(0, 8)
      }
    }

    const hostesses = Array.from(groups.values()).sort((a, b) => b.remaining_amount - a.remaining_amount)
    return NextResponse.json({ hostesses })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
