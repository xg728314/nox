#!/usr/bin/env node
/**
 * nox-cleanup-auditor — P2 SCAFFOLD.
 *
 * Dev-facing bot. Wraps `scripts/cleanup-audit.mjs` and alerts ONLY
 * on regressions (new candidates since the previous run), routed to
 * the developer channel.
 *
 * This bot is not production-critical and never pages ops. It is the
 * only bot whose alerts should be ignorable by an on-call without
 * consequence.
 *
 * What is implemented:
 *   - Runs `node scripts/cleanup-audit.mjs --json` and captures totals.
 *   - Compares against a small state file at
 *       monitoring/state/cleanup-auditor.state.json
 *     (created lazily on first run; not committed).
 *   - Emits BLUE / YELLOW / ORANGE per thresholds.cleanup_auditor.
 *
 * What is scaffolded (TODO):
 *   - Per-finding diff (path-level, not just totals) so the alert says
 *     WHICH file went dead, not just "one more".
 *   - Trend chart inline link (requires a static hosting target).
 *
 * Safe to run pre-production. Read-only wrt. repo state except for
 * the state file it owns.
 */

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { thresholds } from "../shared/config.mjs"
import { severityFromThresholds, max } from "../shared/severity.mjs"
import { sendAlert } from "../shared/telegram.mjs"
import { log, logError } from "../shared/logger.mjs"

const BOT = "nox-cleanup-auditor"
const DRY_RUN = process.argv.includes("--dry-run")
const __filename = fileURLToPath(import.meta.url)
const ROOT = join(dirname(__filename), "..", "..")
const STATE_DIR = join(ROOT, "monitoring", "state")
const STATE_FILE = join(STATE_DIR, "cleanup-auditor.state.json")

function runAudit() {
  const res = spawnSync(
    "node scripts/cleanup-audit.mjs --json",
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true },
  )
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`cleanup-audit failed: status=${res.status} stderr=${(res.stderr ?? "").slice(0, 300)}`)
  }
  return JSON.parse(res.stdout)
}

function readState() {
  if (!existsSync(STATE_FILE)) return null
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) } catch { return null }
}

function writeState(s) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8")
}

function totalsOf(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]))
}

async function main() {
  const t = thresholds().cleanup_auditor

  let result
  try { result = runAudit() }
  catch (e) {
    logError(BOT, "audit:fail", e)
    if (!DRY_RUN) {
      await sendAlert({
        bot: BOT, severity: "YELLOW",
        summary: "cleanup-audit run failed",
        scope: "scripts/cleanup-audit.mjs",
        action: "Fix audit tooling before next tick; no drift data this run",
        evidence: [e.message],
      })
    }
    return
  }

  const current = totalsOf(result.buckets)
  const prev = readState()?.totals ?? null

  const diffs = {}
  if (prev) {
    for (const k of Object.keys(current)) diffs[k] = current[k] - (prev[k] ?? 0)
  }

  log(BOT, "tick:done", { current, prev, diffs })

  writeState({ ts: new Date().toISOString(), totals: current })

  if (!prev) {
    log(BOT, "tick:baseline", { note: "first run, no regression compare" })
    return
  }

  let sev = "GREEN"
  const lines = []
  if (diffs.REVERIFY_BEFORE_DELETE > 0) {
    const s = severityFromThresholds(diffs.REVERIFY_BEFORE_DELETE, {
      blue:   t.new_reverify_candidates_blue,
      yellow: t.new_reverify_candidates_yellow,
    })
    if (s !== "GREEN") {
      lines.push(`+${diffs.REVERIFY_BEFORE_DELETE} REVERIFY candidate(s)`)
      sev = max(sev, s)
    }
  }
  if (diffs.DISK_JUNK_ONLY > 0) {
    const s = severityFromThresholds(diffs.DISK_JUNK_ONLY, { blue: t.new_disk_junk_entries_blue })
    if (s !== "GREEN") {
      lines.push(`+${diffs.DISK_JUNK_ONLY} disk-junk entry/entries`)
      sev = max(sev, s)
    }
  }
  if (diffs.MIGRATION_ANOMALY >= t.migration_anomaly_increase_orange) {
    lines.push(`+${diffs.MIGRATION_ANOMALY} migration anomalies (requires DBA review)`)
    sev = max(sev, "ORANGE")
  }

  if (sev === "GREEN") return   // quiet

  const summary = `Codebase drift detected since last audit`
  const scope = `repo-wide cleanup audit (baseline=${readState()?.ts ?? "n/a"})`
  const action = sev === "ORANGE"
    ? "DBA + developer review — migration anomaly increased"
    : sev === "YELLOW"
      ? "Developer review of new REVERIFY candidates in CLEANUP_AUDIT_FULL.md"
      : "Informational — review at developer convenience"

  const alert = { bot: BOT, severity: sev, summary, scope, action, evidence: lines }
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
