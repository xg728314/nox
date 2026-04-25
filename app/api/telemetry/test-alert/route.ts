import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { sendTelegram } from "@/lib/automation/channels/telegram"

/**
 * POST /api/telemetry/test-alert
 *
 * 2026-04-25: Telegram 알림 채널 연결 확인용. 실제 상태와 무관하게 테스트
 * 메시지 1개 발송. owner 만.
 */
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const now = new Date()
    const ts = now.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })

    const result = await sendTelegram(
      "🧪 NOX 감시봇 테스트 알림\n" +
      `시각: ${ts}\n` +
      `매장: ${auth.store_uuid.slice(0, 8)}\n` +
      `발송자: ${auth.role}\n\n` +
      "이 메시지를 받으셨다면 알림 채널이 정상 동작 중입니다.",
    )

    if (result.ok === false) {
      return NextResponse.json(
        { error: "TELEGRAM_FAILED", message: result.reason || "알림 발송 실패", detail: result },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: (error as Error)?.message ?? "unknown" },
      { status: 500 },
    )
  }
}
