import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * GET /api/chat/unread
 * 현재 사용자의 전체 채팅 unread 합계를 반환한다. (네비 뱃지용 경량 API)
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: participants } = await supabase
      .from("chat_participants")
      .select("unread_count")
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("left_at", null)

    const total = (participants ?? []).reduce(
      (sum: number, p: { unread_count: number }) => sum + (p.unread_count ?? 0), 0
    )

    return NextResponse.json({ unread_count: total })
  } catch (error) {
    return handleRouteError(error, "chat/unread")
  }
}
