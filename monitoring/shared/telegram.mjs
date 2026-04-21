/**
 * Telegram sender with severity → channel routing.
 *
 * Routing table comes from config/channels.json. Per-bot overrides
 * supported. Missing route = no-op (intentional for GREEN).
 *
 * Accepts the unified alert shape:
 *   { bot, severity, summary, scope, action, evidence[], time? }
 *
 * and hands it straight to shared/formatter.mjs. Bots never build
 * markdown themselves.
 */

import { channels as loadChannels } from "./config.mjs"
import { log, logError } from "./logger.mjs"
import { formatAlert } from "./formatter.mjs"

const CHAT_ENV = {
  public: "TELEGRAM_CHAT_PUBLIC",
  ops:    "TELEGRAM_CHAT_OPS",
  dev:    "TELEGRAM_CHAT_DEV",
}

function resolveRoute(bot, severity) {
  const c = loadChannels()
  const perBot = c.overrides?.[bot]?.[severity]
  const fallback = c.default?.[severity] ?? []
  return perBot ?? fallback
}

function resolveChatIds(channels) {
  const ids = []
  for (const ch of channels) {
    const envName = CHAT_ENV[ch]
    const id = envName ? process.env[envName] : null
    if (id) ids.push({ channel: ch, id })
  }
  return ids
}

/**
 * Send a unified alert. Required fields: bot, severity, summary, scope.
 * action defaults to "none — informational". evidence defaults to [].
 * time defaults to ISO now.
 *
 * Return shape (stable contract — verify-delivery.mjs depends on it):
 *   {
 *     sent:       <number of successful deliveries>,
 *     suppressed: <true if severity/token/route caused no-op>,
 *     text:       <rendered MarkdownV2 text, or null if suppressed>,
 *     deliveries: [
 *       { channel, chat_id, ok: true,  status: 200 },
 *       { channel, chat_id, ok: false, status, error }
 *     ]
 *   }
 *
 * `deliveries` is the authoritative source for WHERE this alert landed.
 * The verification harness reads from here in both capture AND live
 * modes so a single code path validates routing.
 */
export async function sendAlert({
  bot,
  severity,
  summary,
  scope,
  action,
  evidence = [],
  time,
}) {
  const targets = resolveChatIds(resolveRoute(bot, severity))
  const token = process.env.TELEGRAM_BOT_TOKEN

  // GREEN / no-route / no-token → structured log only, no network call.
  if (targets.length === 0 || !token) {
    log(bot, "alert:suppressed", {
      severity,
      summary,
      reason: !token ? "no_token" : "no_route",
    })
    return { sent: 0, suppressed: true, text: null, deliveries: [] }
  }

  const text = formatAlert({ bot, severity, summary, scope, action, evidence, time })
  const deliveries = []
  let sent = 0
  for (const tgt of targets) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: tgt.id,
            text,
            parse_mode: "MarkdownV2",
            disable_web_page_preview: true,
          }),
        },
      )
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        logError(bot, "telegram:send_fail", new Error(`status=${res.status}`), {
          channel: tgt.channel,
          body: body.slice(0, 200),
        })
        deliveries.push({
          channel: tgt.channel,
          chat_id: tgt.id,
          ok: false,
          status: res.status,
          error: body.slice(0, 200),
        })
        continue
      }
      sent++
      log(bot, "alert:sent", { severity, channel: tgt.channel, summary })
      deliveries.push({
        channel: tgt.channel,
        chat_id: tgt.id,
        ok: true,
        status: res.status,
      })
    } catch (e) {
      logError(bot, "telegram:network_fail", e, { channel: tgt.channel })
      deliveries.push({
        channel: tgt.channel,
        chat_id: tgt.id,
        ok: false,
        status: 0,
        error: e?.message ?? String(e),
      })
    }
  }
  return { sent, suppressed: false, text, deliveries }
}
