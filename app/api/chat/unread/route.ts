import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { getChatUnread } from "@/lib/server/queries/chatUnread"

/**
 * GET /api/chat/unread
 * 현재 사용자의 전체 채팅 unread 합계를 반환한다. (네비 뱃지용 경량 API)
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    const data = await getChatUnread(authContext)
    return NextResponse.json(data)
  } catch (error) {
    return handleRouteError(error, "chat/unread")
  }
}
