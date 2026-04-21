import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: activeParticipation, error: participationError } = await supabase
      .from("session_participants")
      .select("session_id, room_sessions!inner(status)")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", authContext.membership_id)
      .eq("status", "active")
      .eq("room_sessions.status", "active")
      .limit(1)
      .single()

    const hasActiveSession = !participationError && !!activeParticipation
    const activeSessionId = hasActiveSession ? activeParticipation.session_id : null

    return NextResponse.json({
      user_id: authContext.user_id,
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      membership_status: authContext.membership_status,
      my_shell_enabled: true,
      visible_sections: [
        "my_sessions",
        "my_settlement_status",
        "my_today_summary",
      ],
      has_active_session: hasActiveSession,
      active_session_id: activeSessionId,
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
