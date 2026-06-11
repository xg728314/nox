import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getManagerHostesses } from "@/lib/server/queries/manager/hostesses"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    try {
      const data = await getManagerHostesses(authContext)
      return NextResponse.json(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : undefined
      console.error("[/api/manager/hostesses] QUERY_FAILED:", {
        message: msg,
        stack,
        role: authContext.role,
        store_uuid: authContext.store_uuid,
        membership_id: authContext.membership_id,
      })
      return NextResponse.json(
        {
          error: "QUERY_FAILED",
          message: msg,
          // 디버깅용 (다음 라운드에서 제거): 본인 매장 / 역할 / membership.
          ctx: {
            role: authContext.role,
            store_uuid: authContext.store_uuid?.slice(0, 12),
            membership_id: authContext.membership_id?.slice(0, 12),
          },
        },
        { status: 500 },
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
