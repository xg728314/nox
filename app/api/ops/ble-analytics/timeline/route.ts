import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/timeline
 *
 * Hourly bucketed correction / positive / negative counts across the
 * window. Bucket key is the ISO timestamp of the hour start (UTC).
 * Empty hours are included (count = 0) so the client can render a
 * clean bar chart without gap handling.
 */

function hourStartMs(ms: number): number {
  const d = new Date(ms)
  d.setUTCMinutes(0, 0, 0)
  return d.getTime()
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const supabase = analyticsSupa()
    const { corrections, feedback } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    const fromMs = Date.parse(f.from)
    const toMs = Date.parse(f.to)
    const startHour = hourStartMs(fromMs)
    const endHour = hourStartMs(toMs)
    // Guard against absurd ranges. 31 days = 744 hours max buckets.
    const HOUR_MS = 60 * 60 * 1000
    const maxBuckets = 24 * 31
    const spanHours = Math.min(maxBuckets, Math.max(1, Math.floor((endHour - startHour) / HOUR_MS) + 1))

    type Bucket = { hour_iso: string; corrections: number; positives: number; negatives: number }
    const buckets = new Map<string, Bucket>()
    for (let i = 0; i < spanHours; i++) {
      const hms = startHour + i * HOUR_MS
      const iso = new Date(hms).toISOString()
      buckets.set(iso, { hour_iso: iso, corrections: 0, positives: 0, negatives: 0 })
    }

    const putInto = (iso: string, kind: "corrections" | "positives" | "negatives") => {
      const b = buckets.get(iso)
      if (!b) return
      b[kind] += 1
    }

    for (const c of corrections) {
      const ms = Date.parse(c.corrected_at)
      if (!Number.isFinite(ms)) continue
      const iso = new Date(hourStartMs(ms)).toISOString()
      putInto(iso, "corrections")
    }
    for (const r of feedback) {
      const ms = Date.parse(r.created_at)
      if (!Number.isFinite(ms)) continue
      const iso = new Date(hourStartMs(ms)).toISOString()
      if (r.feedback_type === "positive") putInto(iso, "positives")
      else if (r.feedback_type === "negative") putInto(iso, "negatives")
    }

    const ordered = Array.from(buckets.values()).sort((a, b) => a.hour_iso.localeCompare(b.hour_iso))

    // Peak-hour detector: if max > 3× median (corrections + negatives),
    // flag a recommendation the client can surface.
    const series = ordered.map(b => b.corrections + b.negatives).sort((a, b) => a - b)
    const median = series.length > 0 ? series[Math.floor(series.length / 2)] : 0
    const max = series.length > 0 ? series[series.length - 1] : 0
    const peakFlag = median > 0 && max >= median * 3 && max >= 5
    const peakBucket = peakFlag
      ? ordered.reduce((best, b) =>
          (b.corrections + b.negatives) > (best.corrections + best.negatives) ? b : best,
          ordered[0])
      : null

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      buckets: ordered,
      peak: peakBucket
        ? { hour_iso: peakBucket.hour_iso, corrections: peakBucket.corrections, negatives: peakBucket.negatives }
        : null,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
