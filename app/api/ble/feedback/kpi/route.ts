import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * GET /api/ble/feedback/kpi
 *
 * Tiny KPI payload for the monitor's accuracy strip and the per-user
 * contribution counter. All values are scoped to caller's store and
 * computed from today (server-local midnight → now).
 *
 * Response:
 * {
 *   today_start_iso,
 *   store: {
 *     corrections_today, positive_today, negative_today,
 *     accuracy_rate,        // positive / (positive+negative+corrections); 0..1
 *     top_problem_zone,     // most frequent original_zone among corrections
 *     top_problem_count,
 *   },
 *   me: {
 *     corrections_today, positive_today, negative_today,
 *     contribution_score,   // corrections + positives + negatives
 *   }
 * }
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function todayStartIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can read the BLE KPI." },
        { status: 403 },
      )
    }

    const supabase = supa()
    const storeUuid = auth.store_uuid
    const startIso = todayStartIso()

    // 1. Corrections today — for top-problem zone and store total.
    const { data: corrRows } = await supabase
      .from("ble_presence_corrections")
      .select("original_zone, corrected_by_membership_id")
      .eq("store_uuid", storeUuid)
      .gte("corrected_at", startIso)
    const corrections = (corrRows ?? []) as Array<{ original_zone: string; corrected_by_membership_id: string | null }>

    // 2. Feedback today.
    const { data: fbRows } = await supabase
      .from("ble_feedback")
      .select("feedback_type, zone, by_membership_id")
      .eq("store_uuid", storeUuid)
      .gte("created_at", startIso)
    const fb = (fbRows ?? []) as Array<{ feedback_type: string; zone: string | null; by_membership_id: string }>

    // Aggregate.
    const corrections_today = corrections.length
    const positive_today = fb.filter(r => r.feedback_type === "positive").length
    const negative_today = fb.filter(r => r.feedback_type === "negative").length

    const denom = positive_today + negative_today + corrections_today
    const accuracy_rate = denom > 0 ? Math.max(0, Math.min(1, positive_today / denom)) : 1

    // Top problem zone — mode of correction.original_zone, tied with
    // negative feedback zones (same source of "this was wrong"). Nulls
    // and empties skipped. Labels are not translated here; the client
    // maps to the Korean label if it recognizes the zone code.
    const zoneCounts = new Map<string, number>()
    for (const c of corrections) {
      const z = (c.original_zone || "").trim()
      if (!z) continue
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1)
    }
    for (const f of fb) {
      if (f.feedback_type !== "negative") continue
      const z = (f.zone || "").trim()
      if (!z) continue
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1)
    }
    let top_problem_zone: string | null = null
    let top_problem_count = 0
    for (const [z, n] of zoneCounts) {
      if (n > top_problem_count) {
        top_problem_zone = z
        top_problem_count = n
      }
    }

    // Per-user (the caller).
    const myCorr = corrections.filter(c => c.corrected_by_membership_id === auth.membership_id).length
    const myFb = fb.filter(f => f.by_membership_id === auth.membership_id)
    const my_positive = myFb.filter(r => r.feedback_type === "positive").length
    const my_negative = myFb.filter(r => r.feedback_type === "negative").length
    const me_contribution = myCorr + my_positive + my_negative

    return NextResponse.json({
      today_start_iso: startIso,
      store: {
        corrections_today,
        positive_today,
        negative_today,
        accuracy_rate,
        top_problem_zone,
        top_problem_count,
      },
      me: {
        corrections_today: myCorr,
        positive_today: my_positive,
        negative_today: my_negative,
        contribution_score: me_contribution,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
