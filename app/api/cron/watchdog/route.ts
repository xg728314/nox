import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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