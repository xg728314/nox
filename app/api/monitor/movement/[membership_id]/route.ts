import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/monitor/movement/[membership_id]
 *
 * 24h movement trail for a specific membership.
 * Union: ble_presence_history (raw+corrected) + audit_events (business
 * events). Merged and sorted DESC, LIMIT 100.
 *
 * Auth:
 *   - super_admin: any membership.
 *   - else: membership must be (a) in caller's store OR (b) actively
 *     participating in a session at the caller's store.
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> },
) {
  // 1. Auth
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: 401 })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  const { membership_id } = await params
  if (!isValidUUID(membership_id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "membership_id must be a valid UUID." },
      { status: 400 },
    )
  }

  // 2. Supabase
  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // 3. Authorization check: super or caller-store-linked.
  if (!auth.is_super_admin) {
    const { data: memRow } = await supabase
      .from("store_memberships")
      .select("id, store_uuid")
      .eq("id", membership_id)
      .is("deleted_at", null)
      .maybeSingle()

    let allowed = false
    if (memRow && (memRow as { store_uuid: string }).store_uuid === auth.store_uuid) {
      allowed = true
    } else {
      // active participation in caller's store?
      const { data: partRows } = await supabase
        .from("session_participants")
        .select("id, session_id, room_sessions!inner(store_uuid, status, deleted_at)")
        .eq("membership_id", membership_id)
        .in("status", ["active", "mid_out"])
        .is("deleted_at", null)
        .eq("room_sessions.store_uuid", auth.store_uuid)
        .eq("room_sessions.status", "active")
        .is("room_sessions.deleted_at", null)
        .limit(1)
      if ((partRows ?? []).length > 0) allowed = true
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "SCOPE_FORBIDDEN", message: "membership is outside your scope." },
        { status: 403 },
      )
    }
  }

  // 4. Fetch trails — BLE history + audit events
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // For audit_events we connect via participant_id(s). Gather all
  // participant ids for this membership within last 24h.
  const { data: partIdsRaw } = await supabase
    .from("session_participants")
    .select("id")
    .eq("membership_id", membership_id)
    .gt("entered_at", cutoff)
  const participantIds = ((partIdsRaw ?? []) as Array<{ id: string }>).map(p => p.id)

  const [bleRes, auditRes] = await Promise.all([
    supabase
      .from("ble_presence_history")
      .select("store_uuid, room_uuid, zone, last_event_type, seen_at, source")
      .eq("membership_id", membership_id)
      .gt("seen_at", cutoff)
      .order("seen_at", { ascending: false })
      .limit(200),
    participantIds.length > 0
      ? supabase
          .from("audit_events")
          .select("created_at, event_type, actor_role, entity_table, entity_id, meta, store_uuid")
          .in("entity_id", participantIds)
          .in("event_type", ["participant_checkin", "participant_mid_out", "participant_return", "participant_ended"])
          .gt("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (bleRes.error) {
    return NextResponse.json({ error: "QUERY_FAILED", message: bleRes.error.message }, { status: 500 })
  }
  if (auditRes.error) {
    return NextResponse.json({ error: "QUERY_FAILED", message: auditRes.error.message }, { status: 500 })
  }

  type Item = {
    at: string
    kind: "ble" | "business"
    zone: string | null
    store_uuid: string | null
    room_uuid: string | null
    event_type: string | null
    source: string | null
  }

  const bleItems: Item[] = ((bleRes.data ?? []) as Array<{
    store_uuid: string; room_uuid: string | null; zone: string;
    last_event_type: string | null; seen_at: string; source: string;
  }>).map(r => ({
    at: r.seen_at,
    kind: "ble",
    zone: r.zone,
    store_uuid: r.store_uuid,
    room_uuid: r.room_uuid,
    event_type: r.last_event_type,
    source: r.source,
  }))

  const auditItems: Item[] = ((auditRes.data ?? []) as Array<{
    created_at: string; event_type: string; actor_role: string | null;
    entity_table: string | null; entity_id: string | null;
    meta: Record<string, unknown> | null; store_uuid: string;
  }>).map(r => ({
    at: r.created_at,
    kind: "business",
    zone: null,
    store_uuid: r.store_uuid,
    room_uuid: (r.meta?.room_uuid as string | undefined) ?? null,
    event_type: r.event_type,
    source: null,
  }))

  const merged = [...bleItems, ...auditItems]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 100)

  return NextResponse.json({
    membership_id,
    window_hours: 24,
    items: merged,
  })
}
