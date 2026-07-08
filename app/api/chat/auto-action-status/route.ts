/**
 * GET /api/chat/auto-action-status?message_id=UUID
 *
 * 채팅 메시지 하나에 대해 자동 처리된 결과 (waiting_request / dispatch / etc)
 * 조회. 채팅 UI에서 각 메시지 아래 배지 표시용.
 *
 * R-auto-ops-ui (2026-07-08).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const messageId = url.searchParams.get("message_id")
    if (!messageId || !isValidUUID(messageId)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const { data: actions } = await supabase
      .from("chat_auto_actions")
      .select("id, action_type, parsed_json, ref_id, ref_table, status, error_message, created_at")
      .eq("chat_message_id", messageId)
      .order("created_at", { ascending: true })

    // waiting_request 성공이면 참조된 waiting_request 상세도 조회
    type Action = {
      id: string
      action_type: string
      parsed_json: unknown
      ref_id: string | null
      ref_table: string | null
      status: string
      error_message: string | null
      created_at: string
    }
    const rows = (actions ?? []) as Action[]
    const successAction = rows.find(
      (a) => a.action_type === "waiting_request" && a.status === "success" && a.ref_id,
    )
    let waitingRequest = null
    if (successAction?.ref_id) {
      const { data: wr } = await supabase
        .from("waiting_requests")
        .select("id, categories, guest_count, room_count, tags, guest_note, status, matched_at, expires_at, created_at")
        .eq("id", successAction.ref_id)
        .maybeSingle()
      waitingRequest = wr
    }
    return NextResponse.json({ actions: rows, waiting_request: waitingRequest })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
