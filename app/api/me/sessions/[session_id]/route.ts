import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ session_id: string }> }
) {
  try {
    const { session_id: sessionIdParam } = await params
    const authContext = await resolveAuthContext(request)

    // Role gate: hostess only
    if (authContext.role !== "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "This endpoint is restricted to hostess role." },
        { status: 403 }
      )
    }

    const sessionId = sessionIdParam
    if (!sessionId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify self-participation and get session detail.
    //   select: "session_id, status, room_sessions!inner(status)"
    //   → room_sessions 는 !inner join 이지만 Supabase 는 object 또는 array
    //     로 반환할 수 있음. runtime type guard 로 좁힌다.
    const { data: participation, error: participationError } = await supabase
      .from("session_participants")
      .select("session_id, status, room_sessions!inner(status)")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", authContext.membership_id)
      .eq("session_id", sessionId)
      .single()

    if (participationError || !participation) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found or not linked to this hostess." },
        { status: 404 }
      )
    }

    type SessionShape = { status: string | null }
    type ParticipationJoinRow = {
      session_id: string
      status: string | null
      room_sessions: SessionShape | SessionShape[] | null
    }

    function isParticipationJoinRow(x: unknown): x is ParticipationJoinRow {
      if (!x || typeof x !== "object") return false
      const r = x as Record<string, unknown>
      return "session_id" in r && "room_sessions" in r
    }

    if (!isParticipationJoinRow(participation)) {
      return NextResponse.json(
        { error: "SHAPE_MISMATCH", message: "Unexpected participation row shape." },
        { status: 500 }
      )
    }

    const session = Array.isArray(participation.room_sessions)
      ? participation.room_sessions[0] ?? null
      : participation.room_sessions

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      session: {
        session_id: participation.session_id,
        participant_status: participation.status,
        session_status: session?.status ?? null,
      },
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
