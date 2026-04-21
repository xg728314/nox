/**
 * Unified NOX monitor alert format.
 *
 * Every alert from every bot uses this 7-field block:
 *
 *   bot:      <bot name>
 *   status:   <emoji> <SEVERITY>
 *   summary:  <one-line human-readable headline>
 *   scope:    <what was inspected — route, table, window, etc.>
 *   action:   <what a human should do; "none — informational" is valid>
 *   evidence:
 *     - <fact 1>
 *     - <fact 2>
 *   time:     <ISO8601 UTC>
 *
 * We render the block inside a Telegram MarkdownV2 pre-formatted code
 * fence. Inside a `pre` block only ` and \ need escaping, so the
 * structure survives intact and operators can copy-paste lines into
 * their own runbooks without mojibake.
 *
 * This file is the ONLY place that knows the format. Bots pass
 * structured fields and never build markdown themselves.
 */

import { EMOJI } from "./severity.mjs"

// Inside a MarkdownV2 code fence, only these chars need escaping.
const PRE_ESCAPE = /[`\\]/g
function escPre(s) {
  return String(s ?? "").replace(PRE_ESCAPE, "\\$&")
}

/**
 * Render a single evidence entry. Accepts string | {key, value}.
 */
function renderEvidence(e) {
  if (e == null) return ""
  if (typeof e === "string") return `  - ${escPre(e)}`
  if (typeof e === "object" && "key" in e) {
    return `  - ${escPre(e.key)}=${escPre(e.value)}`
  }
  return `  - ${escPre(JSON.stringify(e))}`
}

/**
 * Build the unified alert block.
 *
 *   formatAlert({
 *     bot: "nox-cutover-sentry",
 *     severity: "RED",
 *     summary: "Owner login probe failed",
 *     scope:   "/api/auth/login (role=owner)",
 *     action:  "Recommend ROLLBACK per CUTOVER_RUNBOOK.md §4",
 *     evidence: ["status=503", "p95=4200ms", "elapsed=4200ms"],
 *     time:    "2026-04-21T04:02:06Z"   // optional; defaults to now
 *   })
 */
export function formatAlert({
  bot,
  severity,
  summary,
  scope,
  action,
  evidence = [],
  time,
}) {
  const emoji = EMOJI[severity] ?? ""
  const ts = time ?? new Date().toISOString()
  const evBlock =
    evidence.length === 0
      ? "  - (none)"
      : evidence.map(renderEvidence).filter(Boolean).join("\n")

  const body = [
    `bot:      ${escPre(bot)}`,
    `status:   ${emoji} ${escPre(severity)}`,
    `summary:  ${escPre(summary ?? "")}`,
    `scope:    ${escPre(scope ?? "")}`,
    `action:   ${escPre(action ?? "none — informational")}`,
    `evidence:`,
    evBlock,
    `time:     ${escPre(ts)}`,
  ].join("\n")

  return "```\n" + body + "\n```"
}
