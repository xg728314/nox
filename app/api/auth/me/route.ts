import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    return NextResponse.json({
      user_id: authContext.user_id,
      membership_id: authContext.membership_id,
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      membership_status: authContext.membership_status,
      // Phase 5 additive: mobile monitor needs to know when to show
      // floor-wide (non-own-floor) tabs. Additive only — existing
      // consumers that ignore this field are unaffected.
      is_super_admin: authContext.is_super_admin,
    })
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
