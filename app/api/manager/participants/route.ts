import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getManagerParticipants } from "@/lib/server/queries/manager/participants"

/**
 * GET /api/manager/participants
 *
 * 실장(manager)이 담당하는 스태프가 참여 중인 session_participants 조회.
 * origin_store_uuid 기준으로 타매장 세션 포함.
 * match_status (matched/unmatched) 포함.
 * 실장은 자기 담당 participant만 볼 수 있음.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "manager" && authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    try {
      const data = await getManagerParticipants(authContext)
      return NextResponse.json(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      return NextResponse.json(
        { error: "QUERY_FAILED", message: msg },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
