#!/usr/bin/env node
/**
 * nox-runtime-monitor — P1 SCAFFOLD (NOT PRODUCTION-READY).
 *
 * Intended responsibility:
 *   - HTTP SLO: 500/503 rate, p95 latency per route
 *   - Cron path health (last-success timestamp from a heartbeat table
 *     or log field)
 *   - Cutover-adjacent runtime regressions (same probes as cutover-
 *     sentry but sampled continuously, not gated on a deploy window)
 *
 * Why scaffolded and not implemented:
 *   1. We do not have a stable log-aggregation endpoint yet. This bot
 *      either needs a Vercel drain → file path (same contract as
 *      security-watch) OR a direct pull from an APM vendor. That
 *      choice is a deployment-topology decision, not a code decision.
 *   2. A meaningful SLO bot needs >= 5 minutes of history per route to
 *      compute p95 without bucketing artifacts. Implementing that
 *      without agreeing on the storage back-end would produce a toy.
 *   3. The three P0 bots already cover cutover correctness and auth
 *      anomalies — the highest-risk surfaces. Runtime SLO is catch-up
 *      noise reduction, not a safety gate.
 *
 * What this file does today:
 *   - Validates env + config wiring so a future implementor only has
 *     to fill in the collection strategy.
 *   - Emits a BLUE "scaffold heartbeat" alert when run with
 *     --heartbeat, so operators can verify the channel route works.
 *
 * TODO(impl):
 *   [ ] Decide collection source: JSONL drain vs. vendor API
 *   [ ] Implement percentile-preserving rolling window
 *   [ ] Implement per-route p95 budget check against
 *       thresholds.runtime_monitor.p95_budget_ms
 *   [ ] Implement cron silence detection (query a cron_heartbeats
 *       table or parse a log marker)
 *   [ ] Add regression check: compare current tick aggregates against
 *       the last N ticks from a small sqlite/JSON state file
 */

import { thresholds } from "../shared/config.mjs"
import { sendAlert } from "../shared/telegram.mjs"
import { log } from "../shared/logger.mjs"

const BOT = "nox-runtime-monitor"
const HEARTBEAT = process.argv.includes("--heartbeat")

async function main() {
  // Fail loud if config was removed — but don't require env until the
  // implementation actually uses it.
  const t = thresholds().runtime_monitor
  if (!t) {
    process.stderr.write("runtime-monitor: thresholds.runtime_monitor missing\n")
    process.exit(2)
  }

  log(BOT, "tick:scaffold", {
    note: "P1 scaffold — no checks implemented yet",
    thresholds_loaded: true,
  })

  if (HEARTBEAT) {
    await sendAlert({
      bot: BOT,
      severity: "BLUE",
      summary: "runtime-monitor scaffold reachable",
      scope: "HTTP SLO (not yet collected)",
      action: "none — informational; implement TODO block before relying on alerts",
      evidence: [
        "P1 scaffold — no real checks run yet",
        "See monitoring/bots/nox-runtime-monitor.mjs TODO block for plan",
      ],
    })
  }
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({ bot: BOT, event: "fatal", error: e?.message }) + "\n")
  process.exit(1)
})
