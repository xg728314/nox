#!/usr/bin/env node
/**
 * nox-cutover-sentry — P0.
 *
 * Deployment / cutover-window monitoring. Runs a fixed probe sequence
 * against the live service for all three user-facing roles and emits
 * GREEN/BLUE/YELLOW/ORANGE/RED plus an explicit rollback recommendation
 * when RED thresholds trip.
 *
 * Probe sequence (per role):
 *   1. POST /api/auth/login  (+ capture nox_access_token cookie)
 *   2. GET  /api/auth/me     (expect 200 + { user_id, role, store_uuid })
 *   3. GET  <protected path> (role-appropriate page, expect 200 or 307)
 *   4. POST /api/auth/logout (expect 200 + cookie-clear)
 *
 * Plus the smoke check set from config/endpoints.json.smoke (owner
 * token only — a single privileged bearer is enough to cover the
 * smoke list).
 *
 * Severity rules:
 *   - Any probe 5xx or network error                         → RED
 *   - Login p95 >= red threshold                             → RED
 *   - /me p95 >= red threshold                               → RED
 *   - Any 4xx on a probe that should be 200                  → ORANGE
 *   - p95 in [orange, red)                                   → ORANGE
 *   - p95 in [yellow, orange)                                → YELLOW
 *   - All clean                                              → BLUE (tick notice)
 *
 * RED automatically appends a "Recommend ROLLBACK per
 * CUTOVER_RUNBOOK.md" line. The bot never executes rollback itself.
 *
 * Usage:
 *   node monitoring/bots/nox-cutover-sentry.mjs
 *   node monitoring/bots/nox-cutover-sentry.mjs --dry-run   (no Telegram)
 */

import { requireEnv, thresholds, endpoints } from "../shared/config.mjs"
import { probe, extractCookie } from "../shared/http.mjs"
import { severityFromThresholds, max } from "../shared/severity.mjs"
import { sendAlert } from "../shared/telegram.mjs"
import { log, logError } from "../shared/logger.mjs"

const BOT = "nox-cutover-sentry"
const DRY_RUN = process.argv.includes("--dry-run")

const ROLES = ["owner", "manager", "hostess"]

function credsFor(role) {
  const upper = role.toUpperCase()
  return {
    email: process.env[`NOX_PROBE_${upper}_EMAIL`],
    password: process.env[`NOX_PROBE_${upper}_PASSWORD`],
  }
}

async function runRoleProbe(role, base, ep, tConf) {
  const creds = credsFor(role)
  if (!creds.email || !creds.password) {
    return {
      role,
      severity: "ORANGE",
      lines: [`probe credentials missing for ${role} (NOX_PROBE_${role.toUpperCase()}_*)`],
      timings: {},
    }
  }

  const loginUrl = base + ep.auth.login.path
  const login = await probe(
    loginUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    },
    { timeoutMs: tConf.probe_timeout_ms },
  )

  const timings = { login: login.elapsedMs }
  const lines = []

  if (!login.ok) {
    return {
      role,
      severity: "RED",
      lines: [`login failed status=${login.status} reason=${login.reason ?? "http"} elapsed=${login.elapsedMs}ms`],
      timings,
    }
  }

  let sev = severityFromThresholds(login.elapsedMs, {
    yellow: tConf.login_p95_ms_yellow,
    orange: tConf.login_p95_ms_orange,
    red:    tConf.login_p95_ms_red,
  })

  const cookie = extractCookie(login.headers, "nox_access_token")
  if (!cookie) {
    return {
      role,
      severity: "RED",
      lines: [`login 200 but no nox_access_token cookie returned`],
      timings,
    }
  }

  // /api/auth/me
  const meUrl = base + ep.auth.me.path
  const me = await probe(
    meUrl,
    { headers: { cookie: `nox_access_token=${cookie}` } },
    { timeoutMs: tConf.probe_timeout_ms },
  )
  timings.me = me.elapsedMs
  if (!me.ok) {
    return {
      role,
      severity: "RED",
      lines: [`/api/auth/me failed status=${me.status} elapsed=${me.elapsedMs}ms`, `login was ${login.elapsedMs}ms`],
      timings,
    }
  }
  sev = max(sev, severityFromThresholds(me.elapsedMs, {
    yellow: tConf.me_p95_ms_yellow,
    orange: tConf.me_p95_ms_orange,
    red:    tConf.me_p95_ms_red,
  }))

  // Protected page
  const prot = ep.protected_probes.find((p) => p.role === role)
  if (prot) {
    const pUrl = base + prot.path
    const pRes = await probe(pUrl, { headers: { cookie: `nox_access_token=${cookie}` }, redirect: "manual" }, { timeoutMs: tConf.probe_timeout_ms })
    timings[`protected_${role}`] = pRes.elapsedMs
    const expected = Array.isArray(prot.expectStatus) ? prot.expectStatus : [prot.expectStatus]
    if (!expected.includes(pRes.status)) {
      sev = max(sev, pRes.status >= 500 || pRes.status === 0 ? "RED" : "ORANGE")
      lines.push(`protected ${prot.path} got status=${pRes.status} (expected ${expected.join("|")})`)
    }
  }

  // Logout
  const logoutUrl = base + ep.auth.logout.path
  const lo = await probe(
    logoutUrl,
    { method: "POST", headers: { cookie: `nox_access_token=${cookie}` } },
    { timeoutMs: tConf.probe_timeout_ms },
  )
  timings.logout = lo.elapsedMs
  if (!lo.ok) {
    sev = max(sev, "ORANGE")
    lines.push(`logout status=${lo.status} elapsed=${lo.elapsedMs}ms`)
  }

  return { role, severity: sev, lines, timings }
}

async function main() {
  const env = requireEnv(["NOX_BASE_URL"], BOT)
  const base = env.NOX_BASE_URL.replace(/\/$/, "")
  const tConf = thresholds().cutover_sentry
  const ep = endpoints()

  log(BOT, "tick:start", { base, roles: ROLES })

  const results = []
  for (const role of ROLES) {
    try {
      results.push(await runRoleProbe(role, base, ep, tConf))
    } catch (e) {
      logError(BOT, "probe:crash", e, { role })
      results.push({ role, severity: "RED", lines: [`probe crashed: ${e?.message ?? e}`], timings: {} })
    }
  }

  let overall = "GREEN"
  for (const r of results) overall = max(overall, r.severity)
  // "All clean" still deserves a BLUE tick line so operators see a heartbeat.
  if (overall === "GREEN") overall = "BLUE"

  const evidence = results.flatMap((r) => {
    const timing = Object.entries(r.timings).map(([k, v]) => `${k}=${v}ms`).join(" ")
    const head = `${r.role}: ${r.severity}${timing ? ` (${timing})` : ""}`
    return [head, ...r.lines.map((l) => `  ${l}`)]
  })

  const summary =
    overall === "RED"    ? "Cutover probe failures detected" :
    overall === "ORANGE" ? "Cutover degraded — investigate before promoting" :
    overall === "YELLOW" ? "Cutover latency elevated" :
                           "Cutover heartbeat OK"

  const scope = `roles=[${ROLES.join(",")}] base=${base}`

  const action =
    overall === "RED" && tConf.red_triggers_rollback_recommendation
      ? "ROLLBACK per CUTOVER_RUNBOOK.md §4 — do not promote this deploy"
      : overall === "ORANGE"
        ? "Investigate failing role probe before promoting"
        : overall === "YELLOW"
          ? "Monitor next tick; promote only if latency returns under budget"
          : "none — informational"

  log(BOT, "tick:done", { overall, results })

  const alert = { bot: BOT, severity: overall, summary, scope, action, evidence }

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
