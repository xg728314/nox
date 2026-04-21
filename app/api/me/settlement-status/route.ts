import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: hostess only
    if (authContext.role !== "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "This endpoint is restricted to hostess role." },
        { status: 403 }
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

    // Find most recent settlement linked to a session this hostess participated in
    const { data: participation, error: participationError } = await supabase
      .from("session_participants")
      .select("session_id, room_sessions!inner(session_id, receipts(status))")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", authContext.membership_id)
      .order("entered_at", { ascending: false })
      .limit(1)
      .single()

    if (participationError || !participation) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        settlement_status: {
          has_settlement: false,
          status: null,
        },
      })
    }

    const sessions = (participation as any).room_sessions
    const settlements = sessions?.receipts

    if (!settlements || (Array.isArray(settlements) && settlements.length === 0)) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        settlement_status: {
          has_settlement: false,
          status: null,
        },
      })
    }

    const settlement = Array.isArray(settlements) ? settlements[0] : settlements

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      settlement_status: {
        has_settlement: true,
        status: settlement.status,
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
