/**
 * Severity model, shared by every bot.
 *
 * Order matters: higher index = more severe. `max(a, b)` lets bots
 * combine per-check severities into a single run-level severity
 * without bespoke logic.
 */

export const LEVELS = ["GREEN", "BLUE", "YELLOW", "ORANGE", "RED"]

export const EMOJI = {
  GREEN:  "🟢",
  BLUE:   "🔵",
  YELLOW: "🟡",
  ORANGE: "🟠",
  RED:    "🔴",
}

export function rank(level) {
  const i = LEVELS.indexOf(level)
  if (i < 0) throw new Error(`unknown severity: ${level}`)
  return i
}

export function max(a, b) {
  return rank(a) >= rank(b) ? a : b
}

/**
 * Promote a raw observation to a severity using a threshold table.
 *
 *   severityFromThresholds(42, { yellow: 30, orange: 100, red: 300 })
 *     → "YELLOW"
 *
 * Missing keys simply don't trigger. Supports monotonically increasing
 * thresholds only — which is what every bot in this repo uses.
 */
export function severityFromThresholds(value, t) {
  if (t.red    != null && value >= t.red)    return "RED"
  if (t.orange != null && value >= t.orange) return "ORANGE"
  if (t.yellow != null && value >= t.yellow) return "YELLOW"
  if (t.blue   != null && value >= t.blue)   return "BLUE"
  return "GREEN"
}
