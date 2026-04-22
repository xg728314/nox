import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getManagerHostessStats } from "@/lib/server/queries/managerHostessStats"

/**
 * GET /api/manager/hostess-stats
 *
 * Returns manager-scoped hostess aggregation:
 * - managed_total: total hostesses assigned to this manager
 * - on_duty_count: checked-in today (available / assigned / in_room)
 * - waiting_count: checked-in but not in any active room (available)
 * - in_room_count: currently in an active session
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    try {
      const data = await getManagerHostessStats(authContext)
      return NextResponse.json(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      return NextResponse.json({ error: "QUERY_FAILED", message: msg }, { status: 500 })
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    console.error("[hostess-stats] unexpected:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
