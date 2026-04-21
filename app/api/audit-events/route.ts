import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"
import { escapePostgrestOrSegment } from "@/lib/security/postgrestEscape"

/**
 * STEP-018: GET /api/audit-events
 *
 * Owner-only audit log viewer. Read-only, store-scoped, paginated.
 *
 * Query params:
 *   action           — exact match or comma-separated list
 *   entity_table     — exact match
 *   entity_id        — uuid
 *   actor_profile_id — uuid
 *   from / to        — ISO timestamps (inclusive start, exclusive end)
 *   q                — substring search on action/reason (server side ilike)
 *   page             — 1-based, default 1
 *   page_size        — default 50, max 200
 *
 * Sensitive columns are never selected (no tokens, no bearer values).
 * `before` / `after` JSON blobs are returned as stored — upstream writers
 * are responsible for not writing secrets (enforced at write-time).
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const SELECT_COLS =
  "id, store_uuid, actor_profile_id, actor_membership_id, actor_role, actor_type, session_id, room_uuid, entity_table, entity_id, action, before, after, reason, created_at"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // STEP-018: owner-only by default.
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()
    const url = new URL(request.url)

    const action = (url.searchParams.get("action") || "").trim().slice(0, 120)
    const entityTable = (url.searchParams.get("entity_table") || "").trim().slice(0, 80)
    const entityId = parseUuid(url.searchParams.get("entity_id"))
    const actorId = parseUuid(url.searchParams.get("actor_profile_id"))
    const fromRaw = url.searchParams.get("from")
    const toRaw = url.searchParams.get("to")
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80)
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("page_size") || "50", 10) || 50))
    const offset = (page - 1) * pageSize

    let query = supabase
      .from("audit_events")
      .select(SELECT_COLS, { count: "exact" })
      .eq("store_uuid", auth.store_uuid)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (action) {
      if (action.includes(",")) {
        const list = action.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20)
        if (list.length > 0) query = query.in("action", list)
      } else {
        query = query.eq("action", action)
      }
    }
    if (entityTable) query = query.eq("entity_table", entityTable)
    if (entityId) query = query.eq("entity_id", entityId)
    if (actorId) query = query.eq("actor_profile_id", actorId)
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (!isNaN(d.getTime())) query = query.gte("created_at", d.toISOString())
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (!isNaN(d.getTime())) query = query.lt("created_at", d.toISOString())
    }
    if (q) {
      // SECURITY (R-4 remediation): user input flows into a `.or()`
      // expression that PostgREST parses as filter grammar. Any of
      // `, . ( ) " ' * \` in `q` would splice arbitrary filter
      // clauses into the WHERE tree. `escapePostgrestOrSegment`
      // rejects those (returns null) and escapes LIKE wildcards
      // for the ilike operator. On rejection we 400 fail-closed.
      const safeQ = escapePostgrestOrSegment(q, "ilike")
      if (safeQ === null) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "q contains unsupported characters." },
          { status: 400 },
        )
      }
      if (safeQ !== "") {
        query = query.or(`action.ilike.%${safeQ}%,reason.ilike.%${safeQ}%`)
      }
    }

    const { data: rows, error, count } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    // Resolve actor display name.
    type Row = {
      id: string
      actor_profile_id: string | null
      [k: string]: unknown
    }
    const events = (rows ?? []) as Row[]
    const pids = Array.from(
      new Set(events.map(e => e.actor_profile_id).filter((x): x is string => !!x))
    )
    const nameById: Record<string, string> = {}
    if (pids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", pids)
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
        nameById[p.id] = p.full_name || p.id.slice(0, 8)
      }
    }
    const enriched = events.map(e => ({
      ...e,
      actor_name: e.actor_profile_id ? (nameById[e.actor_profile_id] ?? e.actor_profile_id.slice(0, 8)) : null,
    }))

    return NextResponse.json({
      page,
      page_size: pageSize,
      total: count ?? enriched.length,
      events: enriched,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
