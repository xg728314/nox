import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-012: GET /api/settlements/managers
 *
 * Returns per-manager payout breakdown aggregated from settlement_items
 * where role_type='manager' for the caller's store. Each manager entry
 * includes the raw settlement_items rows so the UI can show per-line
 * detail and drive the POST /api/settlement/payout call without any
 * client-side recalculation.
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

type ItemRow = {
  id: string
  settlement_id: string
  membership_id: string | null
  amount: number | string
  paid_amount: number | string
  remaining_amount: number | string
  note: string | null
  created_at: string
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // STEP-013A: role gate — per-manager breakdown is owner-only.
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    const { data: itemsRaw } = await supabase
      .from("settlement_items")
      .select("id, settlement_id, membership_id, amount, paid_amount, remaining_amount, note, created_at")
      .eq("store_uuid", auth.store_uuid)
      .eq("role_type", "manager")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(2000)
    const items = (itemsRaw ?? []) as ItemRow[]

    // Filter by confirmed/paid settlement status so 'draft' items do
    // not show as payable. The payout RPC rejects draft anyway, but
    // hiding them keeps the UI honest.
    const settlementIds = Array.from(new Set(items.map(i => i.settlement_id).filter(Boolean)))
    const statusById: Record<string, string> = {}
    if (settlementIds.length > 0) {
      const { data: srows } = await supabase
        .from("settlements")
        .select("id, status")
        .in("id", settlementIds)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
      for (const s of (srows ?? []) as Array<{ id: string; status: string }>) {
        statusById[s.id] = s.status
      }
    }
    const payable = items.filter(i => ["confirmed", "paid"].includes(statusById[i.settlement_id] ?? ""))

    // Resolve manager names.
    const mids = Array.from(new Set(payable.map(i => i.membership_id).filter((x): x is string => !!x)))
    const nameById: Record<string, string> = {}
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
        nameById[m.id] = p?.nickname || p?.full_name || m.id.slice(0, 8)
      }
    }

    // Group by membership_id.
    type Group = {
      membership_id: string
      name: string
      total_amount: number
      paid_amount: number
      remaining_amount: number
      items: Array<{
        id: string
        settlement_id: string
        settlement_status: string
        amount: number
        paid_amount: number
        remaining_amount: number
        note: string | null
        created_at: string
      }>
    }
    const groups = new Map<string, Group>()
    for (const it of payable) {
      const mid = it.membership_id ?? "__unknown__"
      if (!groups.has(mid)) {
        groups.set(mid, {
          membership_id: mid,
          name: nameById[mid] ?? mid.slice(0, 8),
          total_amount: 0,
          paid_amount: 0,
          remaining_amount: 0,
          items: [],
        })
      }
      const g = groups.get(mid)!
      g.total_amount += num(it.amount)
      g.paid_amount += num(it.paid_amount)
      g.remaining_amount += num(it.remaining_amount)
      g.items.push({
        id: it.id,
        settlement_id: it.settlement_id,
        settlement_status: statusById[it.settlement_id] ?? "",
        amount: num(it.amount),
        paid_amount: num(it.paid_amount),
        remaining_amount: num(it.remaining_amount),
        note: it.note,
        created_at: it.created_at,
      })
    }

    const managers = Array.from(groups.values()).sort((a, b) => b.remaining_amount - a.remaining_amount)
    return NextResponse.json({ managers })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
