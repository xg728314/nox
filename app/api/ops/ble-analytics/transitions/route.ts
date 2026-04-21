import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/transitions
 *
 * Counts of (original_zone → corrected_zone) pairs across corrections
 * in scope + window. Client renders as a matrix whose cells are
 * clickable filters for the log view.
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const supabase = analyticsSupa()
    const { corrections } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    const pair = new Map<string, number>()
    const zones = new Set<string>()
    for (const c of corrections) {
      const from = c.original_zone
      const to = c.corrected_zone
      if (!from || !to) continue
      const key = `${from}>${to}`
      pair.set(key, (pair.get(key) ?? 0) + 1)
      zones.add(from)
      zones.add(to)
    }

    const rows: Array<{ from_zone: string; to_zone: string; count: number }> = []
    for (const [key, count] of pair) {
      const [from_zone, to_zone] = key.split(">")
      rows.push({ from_zone, to_zone, count })
    }
    rows.sort((a, b) => b.count - a.count)

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      zones: Array.from(zones).sort(),
      rows,
      total: corrections.length,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
