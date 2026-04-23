/**
 * ROUND-ALERT-1 — Telegram Bot 발송 채널.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN   (필수)
 *   TELEGRAM_CHAT_ID     (필수, 운영자 그룹/개인 chat_id)
 *
 * 설계:
 *   - 실패는 **silent 하지 않음**. 환경변수 누락/API 실패 모두 구조화된
 *     `{ ok: false, reason, detail }` 결과로 반환해 caller 가 로깅/판단.
 *   - throw 하지 않음 — caller (cron) 가 루프 안에서 여러 매장 처리 시
 *     단일 발송 실패로 전체 cron 이 깨지지 않도록.
 *   - 외부 호출에 10초 timeout (AbortController).
 */

export type TelegramSendResult =
  | { ok: true; message_id: number | null }
  | {
      ok: false
      reason:
        | "env_missing"
        | "http_error"
        | "telegram_api_error"
        | "network"
        | "timeout"
      detail?: string
      status?: number
    }

const TIMEOUT_MS = 10_000

export async function sendTelegram(text: string): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    const missing = [!token && "TELEGRAM_BOT_TOKEN", !chatId && "TELEGRAM_CHAT_ID"]
      .filter(Boolean)
      .join(", ")
    // Visible non-silent failure.
    console.error(`[alert] Telegram env missing: ${missing}`)
    return { ok: false, reason: "env_missing", detail: missing }
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[alert] Telegram HTTP ${res.status}: ${body.slice(0, 300)}`)
      return { ok: false, reason: "http_error", status: res.status, detail: body.slice(0, 500) }
    }

    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { message_id?: number }; description?: string }
      | null

    if (!json || json.ok !== true) {
      console.error(`[alert] Telegram API error: ${json?.description ?? "unknown"}`)
      return {
        ok: false,
        reason: "telegram_api_error",
        detail: json?.description ?? "unknown",
      }
    }

    return { ok: true, message_id: json.result?.message_id ?? null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort = msg.toLowerCase().includes("abort")
    console.error(`[alert] Telegram ${isAbort ? "timeout" : "network"}: ${msg}`)
    return { ok: false, reason: isAbort ? "timeout" : "network", detail: msg }
  } finally {
    clearTimeout(timer)
  }
}
