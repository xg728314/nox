/**
 * computePresenceConfidence — deterministic, read-time confidence
 * scorer for a single BLE presence row.
 *
 * DESIGN CONTRACT
 * ──────────────────────────────────────────────────────────────────
 *   - Pure function. No I/O. No persistence. No side effects.
 *   - All inputs come from data the monitor route has ALREADY loaded
 *     (presence row + recent `ble_presence_corrections`). Callers
 *     must NOT issue extra queries per row — see `buildConfidenceContext`
 *     in the same module for batching the per-member correction
 *     history once.
 *   - Never touches BLE raw data. Never writes to the DB. The score
 *     is recomputed on every read; nothing is cached on a row.
 *   - Stable under replay: same inputs ⇒ same outputs.
 *
 * The score range is [0, 1]. The LEVEL is a thresholded bucket so
 * the UI can render a coarse indicator without knowing the score.
 *
 * Phase-1 rule set is deliberately simple so analytics and UI have a
 * single obvious contract. Thresholds are module-level constants so
 * a future round can tune them without touching the callers.
 */

export type ConfidenceLevel = "high" | "medium" | "low"

export type ConfidenceResult = {
  level: ConfidenceLevel
  score: number
  reasons: string[]
}

/** Zones that are historically BLE hotspots — i.e., the gateway is
 *  known to produce noisy readings here. These are not "wrong" zones;
 *  they just warrant a confidence penalty so the operator double-
 *  checks before acting on the reading. */
const HOTSPOT_ZONES = new Set(["restroom", "elevator", "counter"])

/** TTL windows in ms. Mirror the 5-minute monitor cutoff but with a
 *  finer gradient so fresh readings are rewarded and near-expiry
 *  readings are penalized distinctly. */
export const FRESH_MS  = 60 * 1000        // ≤ 60s since last_seen_at → fresh
export const STALE_MS  = 4 * 60 * 1000    // ≥ 4m since last_seen_at → near-expiry

/** Correction-history windows. These must be strictly SHORTER than
 *  the 5-minute overall monitor cutoff so the helper never looks at
 *  history the route didn't already fetch. */
export const CORRECTION_RECENT_WINDOW_MS = 5 * 60 * 1000
export const CORRECTION_VERY_RECENT_MS   = 60 * 1000

/** Flip-flop detection — a member whose last 2 corrections alternate
 *  between two zone-tuples inside this window is treated as unstable. */
export const FLIP_FLOP_WINDOW_MS = 3 * 60 * 1000

/** Level bucket thresholds. score >= HIGH_T → high, score >= MED_T →
 *  medium, else low. Kept conservative to match the "stand out when
 *  unreliable" UX goal. */
export const HIGH_T = 0.80
export const MED_T  = 0.55

export type PresenceInput = {
  membership_id: string
  zone: string
  room_uuid: string | null
  last_seen_at: string
  /** "ble"         — raw BLE reading (full scoring applies)
   *  "corrected"   — human overlay (treated as high-confidence by
   *                  default, with small penalties if the correction
   *                  itself is part of a flip-flop pattern) */
  source: "ble" | "corrected"
}

export type CorrectionHistoryRow = {
  membership_id: string
  corrected_zone: string
  corrected_room_uuid: string | null
  corrected_at: string
}

export type ConfidenceContext = {
  /** Corrections (any zone) for this member, newest-first, already
   *  scoped to the 5-minute monitor window. */
  recentCorrections: CorrectionHistoryRow[]
  /** Evaluation time. Defaults to Date.now() when omitted. */
  nowMs?: number
}

/**
 * Batch helper — groups a flat correction array (as already loaded
 * by the monitor route) into a per-member lookup so the main
 * compute function can be called N times for free. Strictly
 * bounded by the `sinceMs` cutoff the caller already enforced.
 */
export function buildConfidenceContextByMember(
  corrections: CorrectionHistoryRow[],
  nowMs: number = Date.now(),
): Map<string, ConfidenceContext> {
  const cutoff = nowMs - CORRECTION_RECENT_WINDOW_MS
  const out = new Map<string, ConfidenceContext>()
  for (const c of corrections) {
    const t = Date.parse(c.corrected_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    let ctx = out.get(c.membership_id)
    if (!ctx) {
      ctx = { recentCorrections: [], nowMs }
      out.set(c.membership_id, ctx)
    }
    ctx.recentCorrections.push(c)
  }
  // Ensure DESC order — monitor route already orders DESC but we
  // guarantee the invariant here so the rule logic can trust it.
  for (const ctx of out.values()) {
    ctx.recentCorrections.sort((a, b) => Date.parse(b.corrected_at) - Date.parse(a.corrected_at))
  }
  return out
}

export function computePresenceConfidence(
  presence: PresenceInput,
  ctx: ConfidenceContext = { recentCorrections: [] },
): ConfidenceResult {
  const nowMs = ctx.nowMs ?? Date.now()
  const reasons: string[] = []

  // Start from a neutral-high baseline. Each rule that fires nudges
  // the score down (penalty) or up (bonus). Clamp at the end.
  let score = 0.90

  // ── Signal freshness ─────────────────────────────────────────
  const lastMs = Date.parse(presence.last_seen_at)
  if (Number.isFinite(lastMs)) {
    const ageMs = Math.max(0, nowMs - lastMs)
    if (presence.source === "ble") {
      if (ageMs <= FRESH_MS) {
        // very fresh → small bonus, no reason
        score += 0.04
      } else if (ageMs >= STALE_MS) {
        score -= 0.25
        reasons.push("signal_near_expiry")
      } else {
        // moderate age in the 1–4 minute band
        score -= 0.10
        reasons.push("signal_moderate_age")
      }
    }
  } else {
    // Unparseable timestamp is a structural problem; treat as low.
    score -= 0.40
    reasons.push("signal_timestamp_unknown")
  }

  // ── Zone hotspot penalty ─────────────────────────────────────
  if (presence.source === "ble" && HOTSPOT_ZONES.has(presence.zone)) {
    score -= 0.18
    reasons.push("hotspot_zone")
  }

  // Unknown zone = we truly don't know. Large penalty.
  if (presence.source === "ble" && presence.zone === "unknown") {
    score -= 0.35
    reasons.push("zone_unknown")
  }

  // ── Correction history ───────────────────────────────────────
  const corrections = ctx.recentCorrections
  const veryRecentCutoff = nowMs - CORRECTION_VERY_RECENT_MS
  const windowCutoff     = nowMs - CORRECTION_RECENT_WINDOW_MS

  let recentCount = 0
  let veryRecentCount = 0
  for (const c of corrections) {
    const t = Date.parse(c.corrected_at)
    if (!Number.isFinite(t)) continue
    if (t < windowCutoff) continue
    recentCount++
    if (t >= veryRecentCutoff) veryRecentCount++
  }

  if (recentCount >= 2) {
    score -= 0.30
    reasons.push("multiple_recent_corrections")
  } else if (recentCount === 1) {
    score -= 0.12
    reasons.push("recent_correction")
  }
  if (veryRecentCount >= 1 && presence.source === "ble") {
    // A raw BLE reading that disagrees with a correction <60s ago is
    // almost certainly wrong again.
    score -= 0.15
    reasons.push("conflicts_with_very_recent_correction")
  }

  // ── Flip-flop pattern (zone-tuple reversal within window) ───
  if (corrections.length >= 2) {
    const [c0, c1] = corrections
    const t0 = Date.parse(c0.corrected_at)
    const t1 = Date.parse(c1.corrected_at)
    if (Number.isFinite(t0) && Number.isFinite(t1)
        && (nowMs - t1) <= FLIP_FLOP_WINDOW_MS
        && (c0.corrected_zone !== c1.corrected_zone
            || c0.corrected_room_uuid !== c1.corrected_room_uuid)) {
      // last two corrections disagree → the operator keeps changing
      // their mind → target is unstable
      score -= 0.10
      if (!reasons.includes("flip_flop_pattern")) reasons.push("flip_flop_pattern")
    }
  }

  // ── Corrected-source treatment ───────────────────────────────
  // A `corrected` overlay is authoritative by construction — bump
  // the baseline back up unless a flip-flop already fired.
  if (presence.source === "corrected") {
    if (!reasons.includes("flip_flop_pattern")) {
      score += 0.08
      reasons.push("human_corrected")
    }
  }

  // Clamp
  if (score > 1) score = 1
  if (score < 0) score = 0

  const level: ConfidenceLevel =
    score >= HIGH_T ? "high" :
    score >= MED_T  ? "medium" :
                      "low"

  return {
    level,
    score: Math.round(score * 100) / 100,
    reasons,
  }
}
