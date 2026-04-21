import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/floor-map
 *
 * Floor-level zone aggregates + per-room correction counts so the
 * client can render a 5F/6F/7F/8F error heat map using the existing
 * monitor zone vocabulary.
 */

const FLOORS = [5, 6, 7, 8] as const

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const supabase = analyticsSupa()
    const { corrections, feedback } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    // Fetch rooms in scope to map room_uuid → floor_no + room_name.
    let rq = supabase.from("rooms").select("id, room_name, floor_no, store_uuid").is("deleted_at", null)
    if (scope.storeFilter) rq = rq.eq("store_uuid", scope.storeFilter)
    const { data: roomRows } = await rq
    const roomInfo = new Map<string, { room_name: string | null; floor_no: number | null }>()
    for (const r of (roomRows ?? []) as Array<{ id: string; room_name: string | null; floor_no: number | null; store_uuid: string }>) {
      roomInfo.set(r.id, { room_name: r.room_name, floor_no: r.floor_no })
    }

    type FloorAgg = {
      floor: number
      zone_counts: Map<string, number>
      room_counts: Map<string, number>
    }
    const byFloor = new Map<number, FloorAgg>()
    const touch = (floor: number): FloorAgg => {
      let agg = byFloor.get(floor)
      if (!agg) {
        agg = { floor, zone_counts: new Map(), room_counts: new Map() }
        byFloor.set(floor, agg)
      }
      return agg
    }

    for (const c of corrections) {
      const roomUuid = c.original_room_uuid ?? c.corrected_room_uuid
      const floor = roomUuid ? roomInfo.get(roomUuid)?.floor_no ?? null : null
      if (floor === null) continue
      const agg = touch(floor)
      if (c.original_zone) agg.zone_counts.set(c.original_zone, (agg.zone_counts.get(c.original_zone) ?? 0) + 1)
      if (roomUuid) agg.room_counts.set(roomUuid, (agg.room_counts.get(roomUuid) ?? 0) + 1)
    }
    for (const r of feedback) {
      if (r.feedback_type !== "negative") continue
      const floor = r.room_uuid ? roomInfo.get(r.room_uuid)?.floor_no ?? null : null
      if (floor === null) continue
      const agg = touch(floor)
      if (r.zone) agg.zone_counts.set(r.zone, (agg.zone_counts.get(r.zone) ?? 0) + 1)
      if (r.room_uuid) agg.room_counts.set(r.room_uuid, (agg.room_counts.get(r.room_uuid) ?? 0) + 1)
    }

    const floors = FLOORS.map(floor => {
      const agg = byFloor.get(floor)
      const zones = agg
        ? Array.from(agg.zone_counts.entries())
            .map(([zone, error_count]) => ({ zone, error_count }))
            .sort((a, b) => b.error_count - a.error_count)
        : []
      const rooms = agg
        ? Array.from(agg.room_counts.entries())
            .map(([room_uuid, correction_count]) => ({
              room_uuid,
              room_name: roomInfo.get(room_uuid)?.room_name ?? null,
              correction_count,
            }))
            .sort((a, b) => b.correction_count - a.correction_count)
            .slice(0, 12)
        : []
      return { floor, zones, rooms }
    })

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      floors,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
