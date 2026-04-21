import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

/**
 * GET /api/location/corrections/overview
 *
 * super_admin ONLY global rollup. All aggregation happens in JS from
 * a single wide SELECT bounded by `start_date`/`end_date` (default 30d).
 *
 * Non-super callers → 403. URL 조작으로 우회 불가.
 *
 * Response:
 *   { range, totals:{ total, today, reviewer_count, by_error_type },
 *     by_store:[{store_uuid, store_name, total, top_error_type}],
 *     by_floor:[{floor, total}],
 *     by_reviewer:[{user_id, nickname, role, store_uuid, store_name,
 *                   today_count, total_in_range}] }
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function todayKS(): string {
  const now = new Date()
  const ks = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return ks.toISOString().slice(0, 10)
}

function defaultRange(): { start: string; end: string } {
  const end = todayKS()
  const endMs = Date.parse(end + "T00:00:00Z")
  const start = new Date(endMs - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { start, end }
}

const ETYPES = [
  "ROOM_MISMATCH",
  "STORE_MISMATCH",
  "HALLWAY_DRIFT",
  "ELEVATOR_ZONE",
  "MANUAL_INPUT_ERROR",
] as const
type ErrorTypeKey = typeof ETYPES[number]

export async function GET(request: Request) {
  let auth
  try { auth = await resolveAuthContext(request) }
  catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: e.type, message: e.message },
        { status: e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403 },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  // ⛔ super_admin only. Hard gate — no URL override.
  if (!auth.is_super_admin) {
    return NextResponse.json(
      { error: "SCOPE_FORBIDDEN", message: "overview requires super_admin." },
      { status: 403 },
    )
  }

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  const url = new URL(request.url)
  const { start: defStart, end: defEnd } = defaultRange()
  const start_date = url.searchParams.get("start_date") ?? defStart
  const end_date = url.searchParams.get("end_date") ?? defEnd
  const today = todayKS()

  // Single bounded SELECT. For 30 days × avg 50 rows/day = 1500 rows — OK.
  const { data: rows, error } = await supabase
    .from("location_correction_logs")
    .select(`
      corrected_on,
      error_type,
      detected_store_uuid,
      detected_store_name,
      detected_floor,
      corrected_by_user_id,
      corrected_by_nickname,
      corrected_by_role,
      corrected_by_store_uuid,
      corrected_by_store_name
    `)
    .gte("corrected_on", start_date)
    .lte("corrected_on", end_date)

  if (error) {
    return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
  }

  type R = {
    corrected_on: string
    error_type: string
    detected_store_uuid: string | null
    detected_store_name: string | null
    detected_floor: number | null
    corrected_by_user_id: string
    corrected_by_nickname: string
    corrected_by_role: string
    corrected_by_store_uuid: string
    corrected_by_store_name: string
  }
  const list = (rows ?? []) as R[]

  // ── totals ──
  const totals = {
    total: list.length,
    today: list.filter(r => r.corrected_on === today).length,
    reviewer_count: new Set(list.map(r => r.corrected_by_user_id)).size,
    by_error_type: {
      ROOM_MISMATCH: 0,
      STORE_MISMATCH: 0,
      HALLWAY_DRIFT: 0,
      ELEVATOR_ZONE: 0,
      MANUAL_INPUT_ERROR: 0,
    } as Record<ErrorTypeKey, number>,
  }
  for (const r of list) {
    if ((ETYPES as ReadonlyArray<string>).includes(r.error_type)) {
      totals.by_error_type[r.error_type as ErrorTypeKey]++
    }
  }

  // ── by_store (detected store; null 은 "(unknown)" 버킷) ──
  type StoreAgg = { store_uuid: string | null; store_name: string; total: number; by_type: Map<string, number> }
  const byStoreMap = new Map<string, StoreAgg>()
  for (const r of list) {
    const key = r.detected_store_uuid ?? "__unknown__"
    if (!byStoreMap.has(key)) {
      byStoreMap.set(key, {
        store_uuid: r.detected_store_uuid,
        store_name: r.detected_store_name ?? "(unknown)",
        total: 0,
        by_type: new Map(),
      })
    }
    const agg = byStoreMap.get(key)!
    agg.total++
    agg.by_type.set(r.error_type, (agg.by_type.get(r.error_type) ?? 0) + 1)
  }
  const by_store = Array.from(byStoreMap.values())
    .map(a => {
      let topType = ""; let topN = 0
      for (const [t, n] of a.by_type) if (n > topN) { topN = n; topType = t }
      return { store_uuid: a.store_uuid, store_name: a.store_name, total: a.total, top_error_type: topType }
    })
    .sort((a, b) => b.total - a.total)

  // ── by_floor ──
  const byFloorMap = new Map<number | "unknown", number>()
  for (const r of list) {
    const key = r.detected_floor ?? "unknown"
    byFloorMap.set(key, (byFloorMap.get(key) ?? 0) + 1)
  }
  const by_floor = Array.from(byFloorMap.entries())
    .map(([floor, total]) => ({ floor, total }))
    .sort((a, b) => {
      if (a.floor === "unknown") return 1
      if (b.floor === "unknown") return -1
      return (a.floor as number) - (b.floor as number)
    })

  // ── by_reviewer ──
  type RevAgg = {
    user_id: string; nickname: string; role: string
    store_uuid: string; store_name: string
    today: number; total: number
  }
  const byReviewerMap = new Map<string, RevAgg>()
  for (const r of list) {
    if (!byReviewerMap.has(r.corrected_by_user_id)) {
      byReviewerMap.set(r.corrected_by_user_id, {
        user_id: r.corrected_by_user_id,
        nickname: r.corrected_by_nickname,
        role: r.corrected_by_role,
        store_uuid: r.corrected_by_store_uuid,
        store_name: r.corrected_by_store_name,
        today: 0,
        total: 0,
      })
    }
    const agg = byReviewerMap.get(r.corrected_by_user_id)!
    agg.total++
    if (r.corrected_on === today) agg.today++
  }
  const by_reviewer = Array.from(byReviewerMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 100)
    .map(r => ({
      user_id: r.user_id,
      nickname: r.nickname,
      role: r.role,
      store_uuid: r.store_uuid,
      store_name: r.store_name,
      today_count: r.today,
      total_in_range: r.total,
    }))

  return NextResponse.json({
    ok: true,
    range: { start_date, end_date, today },
    totals,
    by_store,
    by_floor,
    by_reviewer,
  })
}
