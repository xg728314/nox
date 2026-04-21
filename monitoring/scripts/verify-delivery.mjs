#!/usr/bin/env node
/**
 * Telegram delivery verification harness for NOX monitor bots.
 *
 * Both modes now read routing truth from the same source: the
 * `deliveries` array on sendAlert()'s return value. That makes
 * capture mode and live mode use one code path for routing checks.
 * Capture mode additionally verifies that a network POST was actually
 * issued (via a fetch interceptor); live mode cannot assert that
 * without snooping the socket, so it relies on Telegram's HTTP 200 +
 * the sender's ok=true delivery record.
 *
 * Default mode (no --live): CAPTURE.
 *   - Sets fake TELEGRAM_* env vars.
 *   - Monkey-patches global.fetch to intercept api.telegram.org POSTs
 *     and record (url, body). Returns a 200 so the sender records ok.
 *   - Walks the full bot × severity matrix + tricky-payload edge case.
 *   - Asserts routing (from deliveries), format (from returned text),
 *     AND "a POST was actually issued" (from the intercepted buffer).
 *
 * Live mode (--live): REAL DELIVERY.
 *   - Requires real TELEGRAM_BOT_TOKEN + at least one chat ID.
 *   - Does NOT patch fetch. Routing + format are verified from the
 *     sender's return value. Every alert actually reaches Telegram.
 *   - Keeps the matrix small (one alert per bot per severity, plus
 *     one edge-case) to respect Telegram's rate limit.
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — at least one assertion failed (details in stdout)
 *   2 — live mode requested but no real token found
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const ROOT = join(dirname(__filename), "..", "..")

const LIVE = process.argv.includes("--live")

// ─── Env gate ──────────────────────────────────────────────────────
if (LIVE) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error(JSON.stringify({ event: "live:not_configured", missing: ["TELEGRAM_BOT_TOKEN"] }))
    process.exit(2)
  }
  const anyChat =
    process.env.TELEGRAM_CHAT_PUBLIC ||
    process.env.TELEGRAM_CHAT_OPS ||
    process.env.TELEGRAM_CHAT_DEV
  if (!anyChat) {
    console.error(JSON.stringify({
      event: "live:not_configured",
      missing: ["at least one of TELEGRAM_CHAT_PUBLIC / TELEGRAM_CHAT_OPS / TELEGRAM_CHAT_DEV"],
    }))
    process.exit(2)
  }
} else {
  process.env.TELEGRAM_BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN   ?? "TEST_TOKEN"
  process.env.TELEGRAM_CHAT_PUBLIC = process.env.TELEGRAM_CHAT_PUBLIC ?? "-1000000000001"
  process.env.TELEGRAM_CHAT_OPS    = process.env.TELEGRAM_CHAT_OPS    ?? "-1000000000002"
  process.env.TELEGRAM_CHAT_DEV    = process.env.TELEGRAM_CHAT_DEV    ?? "-1000000000003"
}

// ─── Fetch interceptor (CAPTURE mode only) ────────────────────────
const captured = []
const realFetch = global.fetch
if (!LIVE) {
  global.fetch = async (url, init = {}) => {
    if (typeof url === "string" && url.startsWith("https://api.telegram.org/")) {
      let body = null
      try { body = JSON.parse(init.body ?? "null") } catch { body = init.body }
      captured.push({ url, body })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return realFetch(url, init)
  }
}

// ─── Dynamic import AFTER env + fetch are wired ───────────────────
const { sendAlert } = await import("../shared/telegram.mjs")

// ─── Assertion helpers ────────────────────────────────────────────
const results = []
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail })
  const tag = cond ? "PASS" : "FAIL"
  process.stdout.write(`[${tag}] ${name}${detail ? " — " + detail : ""}\n`)
}

// ─── Channel config ────────────────────────────────────────────────
const channels = JSON.parse(readFileSync(join(ROOT, "monitoring/config/channels.json"), "utf8"))
delete channels.$comment

const CHAT_BY_CH = {
  public: process.env.TELEGRAM_CHAT_PUBLIC,
  ops:    process.env.TELEGRAM_CHAT_OPS,
  dev:    process.env.TELEGRAM_CHAT_DEV,
}

function expectedChannels(bot, severity) {
  return channels.overrides?.[bot]?.[severity] ?? channels.default?.[severity] ?? []
}

function expectedChats(bot, severity) {
  return expectedChannels(bot, severity)
    .map((ch) => CHAT_BY_CH[ch])
    .filter(Boolean)
}

// ─── Test matrix (smaller in live mode to respect rate limits) ────
const BOTS = [
  "nox-cutover-sentry",
  "nox-security-watch",
  "nox-db-guardian",
  "nox-runtime-monitor",
  "nox-cleanup-auditor",
]
const ALL_SEVERITIES = ["GREEN", "BLUE", "YELLOW", "ORANGE", "RED"]
const LIVE_SEVERITIES = ["BLUE", "ORANGE", "RED"]   // enough to prove routing arms

const SEVERITIES = LIVE ? LIVE_SEVERITIES : ALL_SEVERITIES

const REQUIRED_FIELD_ORDER = ["bot:", "status:", "summary:", "scope:", "action:", "evidence:", "time:"]

async function runOne(bot, severity, evidence) {
  captured.length = 0
  const res = await sendAlert({
    bot,
    severity,
    summary: `verify-${severity}`,
    scope: `verify-delivery harness (${LIVE ? "LIVE" : "CAPTURE"})`,
    action: severity === "RED" ? "test alert — ignore" : "none — informational",
    evidence,
  })
  return { res, intercepted: captured.slice() }
}

function assertFieldOrder(text, bot, severity) {
  const fenced = text?.startsWith("```\n") && text?.endsWith("\n```")
  check(`[${bot}/${severity}] wrapped in MarkdownV2 code fence`, !!fenced)
  const inner = fenced ? text.slice(4, -4) : (text ?? "")
  const positions = REQUIRED_FIELD_ORDER.map((f) => inner.indexOf(f))
  const ordered = positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]))
  check(
    `[${bot}/${severity}] field order bot→status→summary→scope→action→evidence→time`,
    ordered,
    ordered ? "" : `positions=${positions.join(",")}`,
  )
}

// ─── 1. Matrix walk ────────────────────────────────────────────────
console.log(`\n=== 1. Bot × severity matrix (${LIVE ? "LIVE" : "CAPTURE"} mode) ===\n`)

for (const bot of BOTS) {
  for (const sev of SEVERITIES) {
    const { res, intercepted } = await runOne(bot, sev, [
      `sample fact for ${bot} at ${sev}`,
      `numeric=42`,
    ])

    // ─── Routing truth source: sendAlert().deliveries ───────────
    const expectChs = new Set(expectedChannels(bot, sev))
    const expectIds = new Set(expectedChats(bot, sev))
    const deliveredChs = new Set((res.deliveries ?? []).filter((d) => d.ok).map((d) => d.channel))
    const deliveredIds = new Set((res.deliveries ?? []).filter((d) => d.ok).map((d) => String(d.chat_id)))

    if (sev === "GREEN") {
      check(`[${bot}/GREEN] suppressed (no deliveries)`, res.suppressed === true && (res.deliveries ?? []).length === 0)
      if (!LIVE) {
        check(`[${bot}/GREEN] no network POST issued`, intercepted.length === 0)
      }
      continue
    }

    // Channel-name routing (mode-agnostic — the authoritative check).
    check(
      `[${bot}/${sev}] delivered to expected channels`,
      deliveredChs.size === expectChs.size && [...expectChs].every((c) => deliveredChs.has(c)),
      `expected=[${[...expectChs].join(",")}] delivered=[${[...deliveredChs].join(",")}]`,
    )

    // Chat-ID routing sanity — each delivery ID must match the configured env var.
    check(
      `[${bot}/${sev}] chat_ids resolve from env`,
      deliveredIds.size === expectIds.size && [...expectIds].every((id) => deliveredIds.has(id)),
      `expected=[${[...expectIds].join(",")}] delivered=[${[...deliveredIds].join(",")}]`,
    )

    // Per-bot invariants
    if (bot === "nox-cleanup-auditor") {
      check(
        `[${bot}/${sev}] cleanup-auditor routed to dev only`,
        deliveredChs.size > 0 && [...deliveredChs].every((c) => c === "dev"),
      )
    }
    if (sev === "RED" && bot !== "nox-cleanup-auditor") {
      check(`[${bot}/RED] reached public channel`, deliveredChs.has("public"))
      check(`[${bot}/RED] reached ops channel`, deliveredChs.has("ops"))
    }
    if ((sev === "YELLOW" || sev === "ORANGE") && bot !== "nox-cleanup-auditor") {
      check(`[${bot}/${sev}] reached ops channel`, deliveredChs.has("ops"))
      check(`[${bot}/${sev}] did NOT reach public channel`, !deliveredChs.has("public"))
    }

    // Format assertions — read from sender's own returned `text`.
    assertFieldOrder(res.text, bot, sev)
    check(
      `[${bot}/${sev}] text references bot name`,
      typeof res.text === "string" && res.text.includes(bot),
    )

    // Capture mode only: assert a POST was actually issued to each
    // expected chat_id. This is the single thing capture mode can
    // check that live mode cannot.
    if (!LIVE) {
      const postedChatIds = new Set(intercepted.map((p) => String(p.body.chat_id)))
      check(
        `[${bot}/${sev}] network POST issued to every expected chat`,
        expectIds.size === postedChatIds.size && [...expectIds].every((id) => postedChatIds.has(id)),
        `posted=[${[...postedChatIds].join(",")}]`,
      )
      check(
        `[${bot}/${sev}] all intercepted POSTs use parse_mode=MarkdownV2`,
        intercepted.every((p) => p.body?.parse_mode === "MarkdownV2"),
      )
    } else {
      // Live mode: every delivery record must carry HTTP 200 from Telegram.
      check(
        `[${bot}/${sev}] every delivery returned HTTP 200`,
        (res.deliveries ?? []).length > 0 && res.deliveries.every((d) => d.ok && d.status === 200),
        `deliveries=${JSON.stringify(res.deliveries)}`,
      )
    }

    // Live-mode politeness: gap between alerts to stay well under Telegram's 30/s limit.
    if (LIVE) await new Promise((r) => setTimeout(r, 350))
  }
}

// ─── 2. Edge-case evidence payload ─────────────────────────────────
console.log("\n=== 2. MarkdownV2 edge cases in evidence ===\n")
const trickyEvidence = [
  "https://nox.example.com/api/auth/login?x=1&y=2",
  `quotes: "double" 'single'`,
  `commas, inside, fact, count=3`,
  "backtick: `code`",
  "backslash: path\\to\\file",
  "pipe | star * underscore _ brackets [a] (b) {c}",
  "newline\nin\nstring",
  "tab\tseparated\tvalues",
]
const { res: edgeRes } = await runOne("nox-db-guardian", "RED", trickyEvidence)
check(
  "[edge] edge-case alert produced at least one successful delivery",
  (edgeRes.deliveries ?? []).filter((d) => d.ok).length >= 1,
)
if (edgeRes.text) {
  const text = edgeRes.text
  assertFieldOrder(text, "nox-db-guardian", "RED")
  check("[edge] backticks escaped",     text.includes("\\`code\\`"))
  check("[edge] backslashes escaped",   text.includes("path\\\\to\\\\file"))
  check("[edge] URL passes through",    text.includes("https://nox.example.com/api/auth/login?x=1&y=2"))
  check("[edge] commas pass through",   text.includes("commas, inside, fact, count=3"))
  check("[edge] markdown specials pass through in code fence",
        text.includes("pipe | star * underscore _ brackets [a] (b) {c}"))
  check("[edge] newline preserved",     text.includes("newline\nin\nstring"))
}

// ─── 3. Field-order regression sweep ───────────────────────────────
console.log("\n=== 3. Field-order regression sweep ===\n")
const sweepSevs = LIVE ? ["BLUE"] : ["BLUE", "YELLOW", "ORANGE", "RED"]
let sweepFail = 0
for (const bot of BOTS) {
  for (const sev of sweepSevs) {
    const { res } = await runOne(bot, sev, ["sweep-check"])
    if (!res.text) continue
    const text = res.text
    for (const f of REQUIRED_FIELD_ORDER) {
      const occurrences = text.split(f).length - 1
      if (occurrences !== 1) {
        console.log(`  [sweep] ${bot}/${sev}: "${f}" appears ${occurrences}× (expected 1)`)
        sweepFail++
      }
    }
    if (LIVE) await new Promise((r) => setTimeout(r, 350))
  }
}
check("[sweep] every field appears exactly once in every non-GREEN alert", sweepFail === 0)

// ─── 4. Summary ───────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length
const fail = results.filter((r) => !r.ok).length
console.log(`\n=== Summary ===\nPASS: ${pass}\nFAIL: ${fail}\nMODE: ${LIVE ? "LIVE (real delivery)" : "CAPTURE (fetch intercepted)"}\n`)
if (fail > 0) {
  console.log("Failed assertions:")
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}${r.detail ? " :: " + r.detail : ""}`)
  process.exit(1)
}
process.exit(0)
