import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/audit?action=&entity_table=&date=&limit=
 *
 * STEP-021: DEPRECATED. Use GET /api/audit-events for new integrations —
 * that endpoint supports pagination, ranged time queries, and substring
 * search. This route is kept only as a compatibility shim for the
 * existing /audit page and is now owner-only (the manager carve-out was
 * removed to consolidate audit access under a single policy).
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // STEP-021: audit consolidation — owner-only across all audit reads.
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const url = new URL(request.url)
    const actionFilter = url.searchParams.get("action")
    const entityFilter = url.searchParams.get("entity_table")
    const dateFilter = url.searchParams.get("date")
    const limitParam = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200)

    let query = supabase
      .from("audit_events")
      .select("id, actor_profile_id, actor_role, actor_type, session_id, room_uuid, entity_table, entity_id, action, before, after, reason, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .order("created_at", { ascending: false })
      .limit(limitParam)

    if (actionFilter) {
      query = query.eq("action", actionFilter)
    }
    if (entityFilter) {
      query = query.eq("entity_table", entityFilter)
    }
    if (dateFilter) {
      query = query.gte("created_at", `${dateFilter}T00:00:00Z`).lt("created_at", `${dateFilter}T23:59:59Z`)
    }

    const { data: events, error } = await query

    if (error) {
      console.error("[audit] query failed:", error)
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    // actor 이름 조회
    type AuditRow = { id: string; actor_profile_id: string; actor_role: string; actor_type: string | null; session_id: string | null; room_uuid: string | null; entity_table: string; entity_id: string; action: string; before: unknown; after: unknown; reason: string | null; created_at: string }
    const profileIds = [...new Set((events ?? []).map((e: AuditRow) => e.actor_profile_id))]
    const nameMap = new Map<string, string>()

    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds)
      for (const p of profiles ?? []) nameMap.set(p.id, p.full_name || p.id.slice(0, 8))
    }

    const enriched = (events ?? []).map((e: AuditRow) => ({
      ...e,
      actor_name: nameMap.get(e.actor_profile_id) || e.actor_profile_id.slice(0, 8),
    }))

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      count: enriched.length,
      events: enriched,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
