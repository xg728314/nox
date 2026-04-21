/**
 * Config + env loader shared by all bots.
 *
 * Design:
 *   - JSON files are pure configuration (thresholds, routes, endpoints).
 *   - Secrets live in env vars only. No secret ever enters a JSON file.
 *   - `requireEnv(names)` exits the bot with status 2 if anything is
 *     missing, so a misconfigured bot never silently no-ops.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const CONFIG_DIR = join(dirname(__filename), "..", "config")

export function loadJson(name) {
  const p = join(CONFIG_DIR, name)
  const raw = readFileSync(p, "utf8")
  const obj = JSON.parse(raw)
  // Strip top-level `$comment` so bots don't accidentally iterate it.
  if (obj && typeof obj === "object") delete obj.$comment
  return obj
}

export const thresholds = () => loadJson("thresholds.json")
export const channels   = () => loadJson("channels.json")
export const endpoints  = () => loadJson("endpoints.json")

/**
 * Require a set of env vars. Missing vars cause immediate exit(2)
 * with a single structured log line — never a silent continue.
 */
export function requireEnv(names, botName) {
  const missing = names.filter((n) => !process.env[n])
  if (missing.length > 0) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      bot: botName,
      event: "monitor:not_configured",
      missing,
    })
    process.stderr.write(line + "\n")
    process.exit(2)
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]))
}

/**
 * Best-effort env fetch — never throws, never exits. For optional
 * integrations (e.g., runtime-monitor without a cron health URL).
 */
export function optionalEnv(name, fallback = null) {
  return process.env[name] ?? fallback
}
