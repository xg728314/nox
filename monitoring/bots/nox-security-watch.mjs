#!/usr/bin/env node
/**
 * nox-security-watch — P0.
 *
 * Continuous auth-anomaly monitoring. Consumes the auth log stream
 * and pattern-matches for the specific failure codes the R-* security
 * rounds introduced.
 *
 * Input:
 *   JSONL log file at NOX_SECURITY_LOG_PATH. One line per request.
 *   Expected fields (best-effort):
 *     { ts, route, status, error, email?, ip?, profile_id? }
 *   The parser is tolerant — extra fields are ignored, missing fields
 *   downgrade the specificity of the alert but never crash.
 *
 * Detection rules (window = thresholds.security_watch.window_seconds):
 *   - login_fail_spike           : count(error === "INVALID_CREDENTIALS") per window
 *   - otp_abuse_per_identity     : count(route === "/api/auth/otp/verify" && !ok) per (email|profile_id)
 *   - brute_force_per_ip         : count(status === 401 && route startsWith "/api/auth/") per ip
 *   - membership_invalid         : count(error === "MEMBERSHIP_INVALID")
 *   - membership_ambiguous       : count(error === "MEMBERSHIP_AMBIGUOUS")
 *   - security_state_unavailable : count(error === "SECURITY_STATE_UNAVAILABLE")
 *   - rate_limit_trip            : count(status === 429 || error === "RATE_LIMITED")
 *
 * Output:
 *   One Telegram alert per tick at the highest severity observed, with
 *   a per-rule breakdown in the body. Individual correlations (top-N
 *   offending IPs / identities) are included up to 5 entries each to
 *   keep the alert actionable without turning into a log dump.
 *
 * This bot never blocks, bans, or writes. It only reads + alerts.
 */

import { readFileSync, statSync } from "node:fs"
import { requireEnv, thresholds } from "../shared/config.mjs"
import { severityFromThresholds, max } from "../shared/severity.mjs"
import { sendAlert } from "../shared/telegram.mjs"
import { log, logError } from "../shared/logger.mjs"

const BOT = "nox-security-watch"
const DRY_RUN = process.argv.includes("--dry-run")

function parseJsonl(raw) {
  const out = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* skip malformed */ }
  }
  return out
}

function readWindow(path, windowSeconds) {
  const cutoff = Date.now() - windowSeconds * 1000
  let raw = ""
  try {
    const st = statSync(path)
    // Tail-read: for files >2MB read only the last 2MB to stay fast.
    // JSON lines that straddle the tail boundary will fail to parse
    // and be skipped — acceptable for counters.
    if (st.size > 2 * 1024 * 1024) {
      const fd = (() => {
        // lazy import to avoid top-level cost
        return import("node:fs").then((fs) => fs.openSync(path, "r"))
      })()
      // Simpler: just read the whole file; 2MB tail optimisation left
      // as a future improvement. For current log volumes this is fine.
      raw = readFileSync(path, "utf8")
    } else {
      raw = readFileSync(path, "utf8")
    }
  } catch (e) {
    throw new Error(`cannot read log at ${path}: ${e?.message ?? e}`)
  }
  const all = parseJsonl(raw)
  return all.filter((ev) => {
    const ts = typeof ev.ts === "string" ? Date.parse(ev.ts) : Number(ev.ts)
    return Number.isFinite(ts) && ts >= cutoff
  })
}

function topN(counter, n = 5) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}=${v}`)
}

function bump(counter, key) {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function evaluate(events, t) {
  const rules = {
    login_fail_spike: 0,
    otp_abuse: new Map(),        // id → count
    brute_force_ip: new Map(),   // ip → count
    membership_invalid: 0,
    membership_ambiguous: 0,
    security_state_unavailable: 0,
    rate_limit_trip: 0,
  }

  for (const ev of events) {
    const err = ev.error
    const route = ev.route ?? ""
    const status = Number(ev.status)

    if (err === "INVALID_CREDENTIALS") rules.login_fail_spike++
    if (route === "/api/auth/otp/verify" && (err || status >= 400)) {
      bump(rules.otp_abuse, ev.email ?? ev.profile_id ?? "unknown")
    }
    if (status === 401 && route.startsWith("/api/auth/")) {
      bump(rules.brute_force_ip, ev.ip ?? "unknown")
    }
    if (err === "MEMBERSHIP_INVALID") rules.membership_invalid++
    if (err === "MEMBERSHIP_AMBIGUOUS") rules.membership_ambiguous++
    if (err === "SECURITY_STATE_UNAVAILABLE") rules.security_state_unavailable++
    if (status === 429 || err === "RATE_LIMITED") rules.rate_limit_trip++
  }

  const findings = []
  let overall = "GREEN"

  const lfSev = severityFromThresholds(rules.login_fail_spike, {
    yellow: t.login_fail_spike_yellow,
    orange: t.login_fail_spike_orange,
    red:    t.login_fail_spike_red,
  })
  if (lfSev !== "GREEN") {
    findings.push(`login failures: ${rules.login_fail_spike} (${lfSev})`)
    overall = max(overall, lfSev)
  }

  const otpMax = [...rules.otp_abuse.values()].reduce((m, v) => Math.max(m, v), 0)
  const otpSev = severityFromThresholds(otpMax, {
    orange: t.otp_abuse_per_identity_orange,
    red:    t.otp_abuse_per_identity_red,
  })
  if (otpSev !== "GREEN") {
    findings.push(`otp abuse max/identity=${otpMax} — top: ${topN(rules.otp_abuse).join(", ")}`)
    overall = max(overall, otpSev)
  }

  const bfMax = [...rules.brute_force_ip.values()].reduce((m, v) => Math.max(m, v), 0)
  const bfSev = severityFromThresholds(bfMax, {
    orange: t.brute_force_per_ip_orange,
    red:    t.brute_force_per_ip_red,
  })
  if (bfSev !== "GREEN") {
    findings.push(`brute-force max/ip=${bfMax} — top: ${topN(rules.brute_force_ip).join(", ")}`)
    overall = max(overall, bfSev)
  }

  const miSev = severityFromThresholds(rules.membership_invalid, { yellow: t.membership_invalid_yellow })
  if (miSev !== "GREEN") {
    findings.push(`MEMBERSHIP_INVALID: ${rules.membership_invalid}`)
    overall = max(overall, miSev)
  }
  if (rules.membership_ambiguous >= t.membership_ambiguous_orange) {
    findings.push(`MEMBERSHIP_AMBIGUOUS: ${rules.membership_ambiguous} — invariant drift, see db-guardian`)
    overall = max(overall, "ORANGE")
  }
  if (rules.security_state_unavailable >= t.security_state_unavailable_orange) {
    findings.push(`SECURITY_STATE_UNAVAILABLE: ${rules.security_state_unavailable} — rate-limit DB likely unreachable`)
    overall = max(overall, "ORANGE")
  }
  const rlSev = severityFromThresholds(rules.rate_limit_trip, {
    yellow: t.rate_limit_trip_yellow,
    orange: t.rate_limit_trip_orange,
  })
  if (rlSev !== "GREEN") {
    findings.push(`rate-limit trips: ${rules.rate_limit_trip} (${rlSev})`)
    overall = max(overall, rlSev)
  }

  return { overall, findings, counters: {
    login_fail_spike: rules.login_fail_spike,
    otp_abuse_max: otpMax,
    brute_force_max: bfMax,
    membership_invalid: rules.membership_invalid,
    membership_ambiguous: rules.membership_ambiguous,
    security_state_unavailable: rules.security_state_unavailable,
    rate_limit_trip: rules.rate_limit_trip,
  } }
}

async function main() {
  const env = requireEnv(["NOX_SECURITY_LOG_PATH"], BOT)
  const t = thresholds().security_watch

  log(BOT, "tick:start", { path: env.NOX_SECURITY_LOG_PATH, window_s: t.window_seconds })

  let events
  try {
    events = readWindow(env.NOX_SECURITY_LOG_PATH, t.window_seconds)
  } catch (e) {
    logError(BOT, "log:read_fail", e)
    if (!DRY_RUN) {
      await sendAlert({
        bot: BOT,
        severity: "ORANGE",
        summary: "Log source unreadable — counters cannot advance",
        scope: `log=${env.NOX_SECURITY_LOG_PATH}`,
        action: "Restore log stream or fix NOX_SECURITY_LOG_PATH",
        evidence: [e.message],
      })
    }
    return
  }

  const { overall, findings, counters } = evaluate(events, t)
  log(BOT, "tick:done", { overall, events: events.length, counters })

  if (overall === "GREEN") return  // quiet by design; no heartbeat spam

  const summary = `Auth anomaly detected — ${findings.length} rule(s) over threshold`
  const scope = `auth-log window=${t.window_seconds}s events=${events.length}`
  const action =
    overall === "RED"
      ? "Investigate immediately; correlate with db-guardian and rate-limit table"
      : overall === "ORANGE"
        ? "Operator triage — review top offenders in evidence"
        : "Monitor — elevate if next tick stays above threshold"

  const alert = { bot: BOT, severity: overall, summary, scope, action, evidence: findings }
  if (DRY_RUN) {
    console.log(JSON.stringify(alert, null, 2))
    return
  }
  await sendAlert(alert)
}

main().catch((e) => {
  logError(BOT, "fatal", e)
  process.exit(1)
})
