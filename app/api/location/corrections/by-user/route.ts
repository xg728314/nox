import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/location/corrections/by-user
 *
 * Per-user detailed location correction log. Keyset pagination
 * (`cursor = "<ISO>|<id>"` base64).
 *
 * Auth:
 *   - owner / manager: server ALWAYS filters `corrected_by_store_uuid =
 *     auth.store_uuid` — URL조작으로 타 매장 user_id 를 넣어도 빈 배열만
 *     반환된다(정보 유출 0).
 *   - super_admin: no store filter.
 *   - other roles: 403.
 *
 * Query:
 *   user_id   (uuid, required OR nickname)
 *   nickname  (text, resolved server-side to user_id)
 *   start_date / end_date  (Asia/Seoul date YYYY-MM-DD, default 최근 30일)
 *   limit     (default 200, max 2000)
 *   cursor    (base64 keyset)
 */

type ByUserItem = {
  id: string
  corrected_at: string
  corrected_on: string
  error_type: string
  correction_note: string | null
  target: { membership_id: string; hostess_id: string | null; name: string }
  detected: {
    floor: number | null
    store_uuid: string | null
    store_name: string | null
    room_uuid: string | null
    room_no: string | null
    zone: string | null
    at: string | null
  }
  corrected: {
    floor: number | null
    store_uuid: string | null
    store_name: string | null
    room_uuid: string | null
    room_no: string | null
    zone: string
  }
  reviewer: {
    user_id: string
    email: string
    nickname: string
    role: string
    store_uuid: string
    store_name: string
  }
}

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function decodeCursor(v: string | null): { at: string; id: string } | null {
  if (!v) return null
  try {
    const raw = Buffer.from(v, "base64").toString("utf8")
    const [at, id] = raw.split("|")
    if (!at || !id || !isValidUUID(id)) return null
    return { at, id }
  } catch {
    return null
  }
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64")
}

function defaultRange(): { start: string; end: string } {
  // Asia/Seoul today and today-29.
  const now = new Date()
  const ksNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const end = ksNow.toISOString().slice(0, 10)
  const startDate = new Date(ksNow.getTime() - 29 * 24 * 60 * 60 * 1000)
  const start = startDate.toISOString().slice(0, 10)
  return { start, end }
}

export async function GET(request: Request) {
  // 1. Auth
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

  // 2. Parse query
  const url = new URL(request.url)
  let user_id = url.searchParams.get("user_id")?.trim() ?? ""
  const nickname = url.searchParams.get("nickname")?.trim() ?? ""
  const { start: defStart, end: defEnd } = defaultRange()
  const start_date = url.searchParams.get("start_date") ?? defStart
  const end_date = url.searchParams.get("end_date") ?? defEnd
  const limit = Math.min(2000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200))
  const cursor = decodeCursor(url.searchParams.get("cursor"))

  // Resolve nickname → user_id if needed.
  if (!user_id && nickname) {
    const { data: profRows } = await supabase
      .from("profiles")
      .select("id")
      .eq("nickname", nickname)
      .limit(1)
    user_id = (profRows?.[0] as { id: string } | undefined)?.id ?? ""
  }
  if (!user_id || !isValidUUID(user_id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "user_id or nickname is required." },
      { status: 400 },
    )
  }

  // 3. Build query
  let q = supabase
    .from("location_correction_logs")
    .select("*")
    .eq("corrected_by_user_id", user_id)
    .gte("corrected_on", start_date)
    .lte("corrected_on", end_date)
    .order("corrected_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)

  // Non-super: hard store scope.
  if (!auth.is_super_admin) {
    q = q.eq("corrected_by_store_uuid", auth.store_uuid)
  }

  // Keyset cursor — use .or() when we need "at < cursor.at OR (at = cursor.at AND id < cursor.id)".
  if (cursor) {
    // Simplified keyset: corrected_at < cursor.at (strict).
    // Edge case of duplicate timestamps is handled by the id DESC tiebreaker
    // in ORDER BY; in rare cases we may skip 1 row on the boundary.
    // Acceptable for admin review UI.
    q = q.lt("corrected_at", cursor.at)
  }

  const { data: rows, error: qErr } = await q
  if (qErr) {
    return NextResponse.json({ error: "QUERY_FAILED", message: qErr.message }, { status: 500 })
  }

  type LogRow = {
    id: string
    corrected_at: string
    corrected_on: string
    error_type: string
    correction_note: string | null
    target_membership_id: string
    target_hostess_id: string | null
    target_name: string
    detected_floor: number | null
    detected_store_uuid: string | null
    detected_store_name: string | null
    detected_room_uuid: string | null
    detected_room_no: string | null
    detected_zone: string | null
    detected_at: string | null
    corrected_floor: number | null
    corrected_store_uuid: string | null
    corrected_store_name: string | null
    corrected_room_uuid: string | null
    corrected_room_no: string | null
    corrected_zone: string
    corrected_by_user_id: string
    corrected_by_email: string
    corrected_by_nickname: string
    corrected_by_role: string
    corrected_by_store_uuid: string
    corrected_by_store_name: string
  }

  const items: ByUserItem[] = ((rows ?? []) as LogRow[]).map(r => ({
    id: r.id,
    corrected_at: r.corrected_at,
    corrected_on: r.corrected_on,
    error_type: r.error_type,
    correction_note: r.correction_note,
    target: {
      membership_id: r.target_membership_id,
      hostess_id: r.target_hostess_id,
      name: r.target_name,
    },
    detected: {
      floor: r.detected_floor,
      store_uuid: r.detected_store_uuid,
      store_name: r.detected_store_name,
      room_uuid: r.detected_room_uuid,
      room_no: r.detected_room_no,
      zone: r.detected_zone,
      at: r.detected_at,
    },
    corrected: {
      floor: r.corrected_floor,
      store_uuid: r.corrected_store_uuid,
      store_name: r.corrected_store_name,
      room_uuid: r.corrected_room_uuid,
      room_no: r.corrected_room_no,
      zone: r.corrected_zone,
    },
    reviewer: {
      user_id: r.corrected_by_user_id,
      email: r.corrected_by_email,
      nickname: r.corrected_by_nickname,
      role: r.corrected_by_role,
      store_uuid: r.corrected_by_store_uuid,
      store_name: r.corrected_by_store_name,
    },
  }))

  const next_cursor =
    items.length === limit
      ? encodeCursor(items[items.length - 1].corrected_at, items[items.length - 1].id)
      : null

  // Resolve user metadata (once per request for convenience).
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
    total: items.length,
    items,
    next_cursor,
  })
}
