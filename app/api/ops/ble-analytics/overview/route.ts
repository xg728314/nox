import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/overview
 *
 * KPI cards + simple rule-based recommendations for the scope + window.
 * Read-only; never writes any table.
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const supabase = analyticsSupa()
    const { corrections, feedback, saturated } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    const positive = feedback.filter(r => r.feedback_type === "positive").length
    const negative = feedback.filter(r => r.feedback_type === "negative").length
    const corrections_total = corrections.length
    const feedback_total = positive + negative
    const denom = positive + negative + corrections_total
    const accuracy_rate = denom > 0 ? positive / denom : 1

    // Top problem zone — mode of corrections.original_zone + negative feedback.zone
    const zoneCounts = new Map<string, number>()
    for (const c of corrections) {
      if (c.original_zone) zoneCounts.set(c.original_zone, (zoneCounts.get(c.original_zone) ?? 0) + 1)
    }
    for (const r of feedback) {
      if (r.feedback_type === "negative" && r.zone) {
        zoneCounts.set(r.zone, (zoneCounts.get(r.zone) ?? 0) + 1)
      }
    }
    let top_problem_zone: string | null = null
    let top_problem_zone_count = 0
    for (const [z, n] of zoneCounts) {
      if (n > top_problem_zone_count) { top_problem_zone = z; top_problem_zone_count = n }
    }

    // Top problem gateway — same signal but keyed by gateway_id
    const gwCounts = new Map<string, number>()
    for (const c of corrections) {
      if (c.gateway_id) gwCounts.set(c.gateway_id, (gwCounts.get(c.gateway_id) ?? 0) + 1)
    }
    for (const r of feedback) {
      if (r.feedback_type === "negative" && r.gateway_id) {
        gwCounts.set(r.gateway_id, (gwCounts.get(r.gateway_id) ?? 0) + 1)
      }
    }
    let top_problem_gateway: string | null = null
    let top_problem_gateway_count = 0
    for (const [g, n] of gwCounts) {
      if (n > top_problem_gateway_count) { top_problem_gateway = g; top_problem_gateway_count = n }
    }

    // Per-user contribution
    const me_corr = corrections.filter(c => c.corrected_by_membership_id === auth.membership_id).length
    const me_pos = feedback.filter(r => r.by_membership_id === auth.membership_id && r.feedback_type === "positive").length
    const me_neg = feedback.filter(r => r.by_membership_id === auth.membership_id && r.feedback_type === "negative").length
    const me_contribution = me_corr + me_pos + me_neg

    // ── Rule-based recommendations ─────────────────────────────────
    const recs: Array<{ code: string; severity: "info"|"warning"|"critical"; message: string; context?: Record<string, unknown> }> = []

    // Accuracy-level tiers.
    const pct = Math.round(accuracy_rate * 100)
    if (denom >= 20) {
      if (pct < 60) {
        recs.push({
          code: "low_accuracy",
          severity: "critical",
          message: `전체 정확도 ${pct}% — BLE 배치/태그 점검이 시급합니다.`,
          context: { accuracy_rate, sample: denom },
        })
      } else if (pct < 80) {
        recs.push({
          code: "moderate_accuracy",
          severity: "warning",
          message: `전체 정확도 ${pct}% — 특정 게이트웨이/존 점검을 권장합니다.`,
          context: { accuracy_rate, sample: denom },
        })
      }
    }

    // Restroom / elevator / counter mis-reads.
    if (top_problem_zone_count >= 5) {
      if (top_problem_zone === "restroom") {
        recs.push({
          code: "restroom_misread_high",
          severity: "warning",
          message: `화장실 오탐 ${top_problem_zone_count}건 — 인근 게이트웨이 신호 간섭을 점검하세요.`,
          context: { zone: top_problem_zone, count: top_problem_zone_count },
        })
      } else if (top_problem_zone === "elevator") {
        recs.push({
          code: "elevator_misread_high",
          severity: "warning",
          message: `엘리베이터 오탐 ${top_problem_zone_count}건 — 엘베 게이트웨이 범위/지연을 점검하세요.`,
          context: { zone: top_problem_zone, count: top_problem_zone_count },
        })
      } else if (top_problem_zone === "counter") {
        recs.push({
          code: "counter_misread_high",
          severity: "warning",
          message: `카운터 오탐 ${top_problem_zone_count}건 — 카운터 게이트웨이 방향/전력 설정을 확인하세요.`,
          context: { zone: top_problem_zone, count: top_problem_zone_count },
        })
      }
    }

    // Saturated dataset — analysis may be incomplete.
    if (saturated) {
      recs.push({
        code: "dataset_saturated",
        severity: "info",
        message: "표시된 샘플이 조회 한도(행 수)에 도달했습니다. 필터를 좁혀 다시 확인하세요.",
      })
    }

    // Unclassified zone — any row whose zone is outside the known enum.
    const KNOWN = new Set(["room","counter","restroom","elevator","external_floor","lounge","unknown"])
    const unknown_zones = Array.from(zoneCounts.keys()).filter(z => !KNOWN.has(z))
    if (unknown_zones.length > 0) {
      recs.push({
        code: "unclassified_zone",
        severity: "info",
        message: `알 수 없는 zone 값 감지: ${unknown_zones.slice(0, 4).join(", ")}`,
        context: { zones: unknown_zones },
      })
    }

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      kpis: {
        corrections_total,
        feedback_total,
        feedback_positive: positive,
        feedback_negative: negative,
        accuracy_rate,
        top_problem_zone,
        top_problem_zone_count,
        top_problem_gateway,
        top_problem_gateway_count,
        me_contribution,
      },
      recommendations: recs,
      saturated,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
