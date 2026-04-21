import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

/**
 * GET /api/monitor/stores?floor=N
 *
 * Floor → stores list. Data source for mobile 2-tier menu
 * (tab "5F" → sheet of stores on 5F).
 *
 * Auth:
 *   - super_admin: all stores with rooms on floor N
 *   - else: only caller's store, iff it has rooms on floor N
 *
 * Response: `{ floor, stores: [{ store_uuid, store_name, is_mine,
 *   active_sessions, total_rooms }] }`.
 *
 * Single query layer: 3 parallel queries + in-memory aggregate.
 * No store-loop, no /api/counter/monitor fan-out.
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: Request) {
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

  // 2. Parse floor
  const url = new URL(request.url)
  const floorRaw = url.searchParams.get("floor")
  const floor = floorRaw ? parseInt(floorRaw, 10) : NaN
  if (!Number.isInteger(floor) || floor < 5 || floor > 8) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "floor must be an integer in [5,8]." },
      { status: 400 },
    )
  }

  // 3. Supabase
  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // 4. Resolve visible stores
  //    - super_admin: all stores with at least one room on the requested floor
  //    - else: own store only (if it has rooms on that floor)
  let visibleStoreUuids: string[] = []
  if (auth.is_super_admin) {
    const { data: roomRows, error } = await supabase
      .from("rooms")
      .select("store_uuid")
      .eq("floor_no", floor)
      .is("deleted_at", null)
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    visibleStoreUuids = Array.from(new Set(
      (roomRows ?? []).map((r: { store_uuid: string }) => r.store_uuid),
    ))
  } else {
    const { data: ownRooms, error } = await supabase
      .from("rooms")
      .select("store_uuid")
      .eq("store_uuid", auth.store_uuid)
      .eq("floor_no", floor)
      .is("deleted_at", null)
      .limit(1)
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    if ((ownRooms ?? []).length > 0) visibleStoreUuids = [auth.store_uuid]
  }

  if (visibleStoreUuids.length === 0) {
    return NextResponse.json({ floor, stores: [] })
  }

  // 5. Parallel queries
  const [storesRes, roomsRes, sessionsRes] = await Promise.all([
    supabase
      .from("stores")
      .select("id, store_name")
      .in("id", visibleStoreUuids)
      .is("deleted_at", null)
      .eq("is_active", true),
    supabase
      .from("rooms")
      .select("store_uuid, floor_no")
      .in("store_uuid", visibleStoreUuids)
      .is("deleted_at", null),
    supabase
      .from("room_sessions")
      .select("store_uuid")
      .in("store_uuid", visibleStoreUuids)
      .eq("status", "active")
      .is("deleted_at", null),
  ])

  for (const r of [storesRes, roomsRes, sessionsRes]) {
    if (r.error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: r.error.message }, { status: 500 })
    }
  }

  const totalRoomsByStore = new Map<string, number>()
  for (const r of (roomsRes.data ?? []) as Array<{ store_uuid: string; floor_no: number | null }>) {
    if (r.floor_no === floor) {
      totalRoomsByStore.set(r.store_uuid, (totalRoomsByStore.get(r.store_uuid) ?? 0) + 1)
    }
  }
  const activeSessionsByStore = new Map<string, number>()
  for (const s of (sessionsRes.data ?? []) as Array<{ store_uuid: string }>) {
    activeSessionsByStore.set(s.store_uuid, (activeSessionsByStore.get(s.store_uuid) ?? 0) + 1)
  }

  const stores = ((storesRes.data ?? []) as Array<{ id: string; store_name: string }>).map(s => ({
    store_uuid: s.id,
    store_name: s.store_name,
    is_mine: s.id === auth.store_uuid,
    active_sessions: activeSessionsByStore.get(s.id) ?? 0,
    total_rooms: totalRoomsByStore.get(s.id) ?? 0,
  }))

  return NextResponse.json({ floor, stores })
}
