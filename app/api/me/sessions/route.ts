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

    const { data: participations, error: participationsError } = await supabase
      .from("session_participants")
      .select("session_id, status, room_sessions!inner(status)")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", authContext.membership_id)
      .order("entered_at", { ascending: false })

    if (participationsError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query sessions." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      sessions: (participations ?? []).map((p: { session_id: string; status: string; room_sessions: { status: string }[] }) => ({
        session_id: p.session_id,
        participant_status: p.status,
        session_status: p.room_sessions?.[0]?.status ?? "",
      })),
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
