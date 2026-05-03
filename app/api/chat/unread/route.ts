import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { getChatUnread } from "@/lib/server/queries/chatUnread"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 네비 뱃지 — 매 polling cycle hit. 5s TTL + max-age=3.
const UNREAD_TTL_MS = 5000

/**
 * GET /api/chat/unread
 * 현재 사용자의 전체 채팅 unread 합계를 반환한다. (네비 뱃지용 경량 API)
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    const cacheKey = `${authContext.store_uuid}:${authContext.membership_id}`
    const data = await cached(
      "chat_unread",
      cacheKey,
      UNREAD_TTL_MS,
      () => getChatUnread(authContext),
    )
    const res = NextResponse.json(data)
    res.headers.set("Cache-Control", "private, max-age=3, stale-while-revalidate=10")
    return res
  } catch (error) {
    return handleRouteError(error, "chat/unread")
  }
}
