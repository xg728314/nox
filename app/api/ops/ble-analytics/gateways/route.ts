import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/gateways
 *
 * Gateway ranking by correction rate over the window. For each
 * gateway_id seen in either corrections or feedback, we compute:
 *   - related_events  = corrections + feedback rows referencing it
 *   - correction_count
 *   - correction_rate = correction_count / max(related_events, 1)
 *   - top_transition  = most-frequent (original→corrected) pair for
 *                       this gateway
 *   - status          = critical if correction_rate ≥ 0.5 OR related
 *                       ≥ 20; warning if ≥ 0.25; normal otherwise.
 *
 * Gateway metadata is looked up from `ble_gateways` (store, room, type)
 * scoped to the caller's allowed stores.
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const supabase = analyticsSupa()
    const { corrections, feedback } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    type GwAgg = {
      gateway_id: string
      related_events: number
      correction_count: number
      pair_counts: Map<string, number>
    }
    const agg = new Map<string, GwAgg>()

    const touch = (gid: string): GwAgg => {
      const found = agg.get(gid)
      if (found) return found
      const created: GwAgg = {
        gateway_id: gid,
        related_events: 0,
        correction_count: 0,
        pair_counts: new Map(),
      }
      agg.set(gid, created)
      return created
    }

    for (const c of corrections) {
      if (!c.gateway_id) continue
      const g = touch(c.gateway_id)
      g.related_events += 1
      g.correction_count += 1
      const pair = `${c.original_zone}>${c.corrected_zone}`
      g.pair_counts.set(pair, (g.pair_counts.get(pair) ?? 0) + 1)
    }
    for (const r of feedback) {
      if (!r.gateway_id) continue
      const g = touch(r.gateway_id)
      g.related_events += 1
      // feedback does NOT add to correction_count — only explicit corrections do
    }

    const gatewayIds = Array.from(agg.keys())

    // Lookup metadata scoped to allowed stores.
    let metaRows: Array<{
      gateway_id: string
      store_uuid: string
      gateway_type: string | null
      room_uuid: string | null
      display_name: string | null
    }> = []
    if (gatewayIds.length > 0) {
      let mq = supabase
        .from("ble_gateways")
        .select("gateway_id, store_uuid, gateway_type, room_uuid, display_name")
        .in("gateway_id", gatewayIds)
      if (scope.storeFilter) mq = mq.eq("store_uuid", scope.storeFilter)
      const { data } = await mq
      metaRows = (data ?? []) as typeof metaRows
    }
    const metaById = new Map(metaRows.map(m => [m.gateway_id, m]))

    // Store + room name lookups.
    const storeUuids = Array.from(new Set(metaRows.map(m => m.store_uuid)))
    const roomUuids = Array.from(new Set(metaRows.map(m => m.room_uuid).filter((x): x is string => !!x)))
    const storeNames = new Map<string, string>()
    const roomInfo = new Map<string, { name: string | null; floor_no: number | null }>()
    if (storeUuids.length > 0) {
      const { data } = await supabase.from("stores").select("id, store_name").in("id", storeUuids).is("deleted_at", null)
      for (const s of (data ?? []) as Array<{ id: string; store_name: string }>) storeNames.set(s.id, s.store_name)
    }
    if (roomUuids.length > 0) {
      const { data } = await supabase.from("rooms").select("id, room_name, floor_no").in("id", roomUuids).is("deleted_at", null)
      for (const r of (data ?? []) as Array<{ id: string; room_name: string | null; floor_no: number | null }>) {
        roomInfo.set(r.id, { name: r.room_name, floor_no: r.floor_no })
      }
    }

    const rows = Array.from(agg.values()).map(g => {
      const meta = metaById.get(g.gateway_id)
      let top_pair: { from: string; to: string; count: number } | null = null
      for (const [k, n] of g.pair_counts) {
        if (!top_pair || n > top_pair.count) {
          const [from, to] = k.split(">")
          top_pair = { from, to, count: n }
        }
      }
      const correction_rate = g.related_events > 0 ? g.correction_count / g.related_events : 0
      const status: "normal" | "warning" | "critical" =
        correction_rate >= 0.5 || g.correction_count >= 20 ? "critical" :
        correction_rate >= 0.25 ? "warning" :
        "normal"

      const room = meta?.room_uuid ? roomInfo.get(meta.room_uuid) ?? null : null
      return {
        gateway_id: g.gateway_id,
        display_name: meta?.display_name ?? null,
        gateway_type: meta?.gateway_type ?? null,
        room_uuid: meta?.room_uuid ?? null,
        room_name: room?.name ?? null,
        floor_no: room?.floor_no ?? null,
        store_uuid: meta?.store_uuid ?? null,
        store_name: meta?.store_uuid ? storeNames.get(meta.store_uuid) ?? null : null,
        related_events: g.related_events,
        correction_count: g.correction_count,
        correction_rate,
        top_transition: top_pair,
        status,
      }
    }).sort((a, b) => {
      const rank = (s: "normal"|"warning"|"critical") => s === "critical" ? 0 : s === "warning" ? 1 : 2
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status)
      return b.correction_count - a.correction_count
    })

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      rows,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
