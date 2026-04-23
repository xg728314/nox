import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getStoreStaff } from "@/lib/server/queries/storeStaff"
import { loadAttendanceVisibility } from "@/lib/server/queries/attendanceVisibility"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const storeNameParam = searchParams.get("store_name")
    const storeUuidParam = searchParams.get("store_uuid")
    const roleParam = searchParams.get("role")

    try {
      const visibilityMode = await loadAttendanceVisibility(getServiceClient(), authContext)
      const data = await getStoreStaff(
        authContext,
        {
          store_name: storeNameParam,
          store_uuid: storeUuidParam,
          role: roleParam,
        },
        { visibilityMode },
      )
      return NextResponse.json({ ...data, visibility_mode: visibilityMode })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      console.error("store staff error:", msg)
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
