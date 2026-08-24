import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"

/** R-cron-auth-hardening (2026-08-24): 이전엔 `!==` 비교 + CRON_SECRET 미설정 시
 *  `"Bearer undefined"` 문자열 매칭으로 attacker 가 `Authorization: Bearer undefined`
 *  헤더만 있으면 통과. Timing-safe 비교 + secret 필수. */
function verifyCronBearer(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false
  if (!authHeader) return false
  const prefix = "Bearer "
  if (!authHeader.startsWith(prefix)) return false
  const provided = authHeader.slice(prefix.length).trim()
  if (!provided) return false
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(secret, "utf8")
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!verifyCronBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const issues: string[] = []

  // 1. DB ping
  try {
    const res = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/", {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
    })
    if (!res.ok) issues.push("DB DOWN")
  } catch {
    issues.push("DB FETCH FAIL")
  }

  // 2. BLE 최근 이벤트 (예시)
  try {
    const r = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/ble_events?limit=1&order=created_at.desc", {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
    })
    const data = await r.json()
    const last = data?.[0]?.created_at
    if (!last) issues.push("BLE NO DATA")
  } catch {
    issues.push("BLE CHECK FAIL")
  }

  // 3. 결과
  if (issues.length > 0) {
    await sendTelegram(`🚨 NOX WATCHDOG ALERT\n${issues.join("\n")}`)
  }

  return NextResponse.json({ ok: true, issues })
}

async function sendTelegram(msg: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: msg,
    }),
  })
}