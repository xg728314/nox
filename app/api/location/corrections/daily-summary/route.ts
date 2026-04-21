import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/location/corrections/daily-summary
 *
 * Daily breakdown for a specific reviewer. Client-side aggregation from
 * a narrow SELECT (minimal columns, bounded range). Acceptable at Phase
 * 4 volume (≤ 30 days × a few hundred rows/day ≈ few thousand rows).
 *
 * Auth:
 *   - owner/manager: server forces `corrected_by_store_uuid = auth.store_uuid`
 *   - super_admin: no filter
 *   - other: 403
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function defaultRange(): { start: string; end: string } {
  const now = new Date()
  const ksNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const end = ksNow.toISOString().slice(0, 10)
  const startDate = new Date(ksNow.getTime() - 29 * 24 * 60 * 60 * 1000)
  const start = startDate.toISOString().slice(0, 10)
  return { start, end }
}

const ERROR_TYPE_KEYS = [
  "ROOM_MISMATCH",
  "STORE_MISMATCH",
  "HALLWAY_DRIFT",
  "ELEVATOR_ZONE",
  "MANUAL_INPUT_ERROR",
] as const
type ErrorTypeKey = typeof ERROR_TYPE_KEYS[number]

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
  const allowed = auth.role === "owner" || auth.role === "manager" || auth.is_super_admin
  if (!allowed) {
    return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
  }

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  const url = new URL(request.url)
  let user_id = url.searchParams.get("user_id")?.trim() ?? ""
  const nickname = url.searchParams.get("nickname")?.trim() ?? ""
  if (!user_id && nickname) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("nickname", nickname)
      .limit(1)
    user_id = (data?.[0] as { id: string } | undefined)?.id ?? ""
  }
  if (!user_id || !isValidUUID(user_id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "user_id or nickname is required." },
      { status: 400 },
    )
  }
  const { start: defStart, end: defEnd } = defaultRange()
  const start_date = url.searchParams.get("start_date") ?? defStart
  const end_date = url.searchParams.get("end_date") ?? defEnd

  let q = supabase
    .from("location_correction_logs")
    .select("corrected_on, error_type")
    .eq("corrected_by_user_id", user_id)
    .gte("corrected_on", start_date)
    .lte("corrected_on", end_date)

  if (!auth.is_super_admin) {
    q = q.eq("corrected_by_store_uuid", auth.store_uuid)
  }

  const { data: rows, error } = await q
  if (error) {
    return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
  }

  // Client-side aggregate: Map<date, per-type counts>
  type Day = {
    date: string
    total: number
    by_error_type: Record<ErrorTypeKey, number>
  }
  const byDate = new Map<string, Day>()

  for (const row of (rows ?? []) as Array<{ corrected_on: string; error_type: string }>) {
    const date = row.corrected_on
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        total: 0,
        by_error_type: {
          ROOM_MISMATCH: 0,
          STORE_MISMATCH: 0,
          HALLWAY_DRIFT: 0,
          ELEVATOR_ZONE: 0,
          MANUAL_INPUT_ERROR: 0,
        },
      })
    }
    const day = byDate.get(date)!
    day.total++
    if ((ERROR_TYPE_KEYS as ReadonlyArray<string>).includes(row.error_type)) {
      day.by_error_type[row.error_type as ErrorTypeKey]++
    }
  }

  const days = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1))

  // Resolve user metadata
  const { data: profRow } = await supabase
    .from("profiles")
    .select("id, nickname, full_name")
    .eq("id", user_id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    user: {
      id: user_id,
      nickname: (profRow as { nickname: string | null } | null)?.nickname ?? null,
      full_name: (profRow as { full_name: string | null } | null)?.full_name ?? null,
    },
    range: { start_date, end_date },
    days,
  })
}
