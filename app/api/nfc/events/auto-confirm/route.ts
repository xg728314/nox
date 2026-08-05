/**
 * POST /api/nfc/events/auto-confirm
 *   Cron endpoint (GitHub Actions 5분 주기 or 별도 1분 주기 · CRON_SECRET 요구)
 *   1분 이상 pending 상태 이벤트 → status=auto_confirmed · 매크로 채팅 발행
 *   30분 이상 pending → status=expired (매크로 미발행)
 */
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { publishNfcMacroChat } from "@/lib/chat/publishNfcMacroChat"

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const sb = getServiceClient()
  const nowIso = new Date().toISOString()
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString()
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()

  try {
    // 30분+ pending → expired (매크로 미발행)
    await sb
      .from("nfc_scan_events")
      .update({ status: "expired", confirmed_at: nowIso })
      .eq("status", "pending")
      .lt("scanned_at", thirtyMinAgo)

    // 1분+ pending 且 30분 이내 → auto_confirmed + 매크로 발행
    const { data: toConfirm } = await sb
      .from("nfc_scan_events")
      .select("id, store_uuid, room_uuid, tag_type, actor_membership_id, session_id, participant_id, scanned_at, status")
      .eq("status", "pending")
      .lt("scanned_at", oneMinAgo)
      .gte("scanned_at", thirtyMinAgo)
      .limit(200)

    const events = toConfirm ?? []
    let confirmed = 0
    for (const ev of events) {
      const { data: upd, error } = await sb
        .from("nfc_scan_events")
        .update({ status: "auto_confirmed", confirmed_at: nowIso })
        .eq("id", (ev as { id: string }).id)
        .eq("status", "pending")
        .select("id, status, store_uuid, room_uuid, tag_type, actor_membership_id, session_id, participant_id, scanned_at, confirmed_at")
        .maybeSingle()
      if (error || !upd) continue
      confirmed++
      // 매크로 발행 (best-effort · 시스템 컨텍스트 · auth null)
      try {
        await publishNfcMacroChat({ auth: null, event: upd as never })
      } catch { /* silent */ }
    }
    return NextResponse.json({ auto_confirmed: confirmed, total_pending_processed: events.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "err"
    if (msg.includes("does not exist") || msg.includes("42P01")) {
      return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: msg }, { status: 500 })
  }
}
