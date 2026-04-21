import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const url = new URL(request.url)
    const businessDayId = url.searchParams.get("business_day_id")

    if (!businessDayId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id query param is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Verify business_day
    const { data: opDay, error: opError } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status")
      .eq("id", businessDayId)
      .eq("store_uuid", authContext.store_uuid)
      .single()

    if (opError || !opDay) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Operating day not found." },
        { status: 404 }
      )
    }

    // 2. Determine which membership(s) to query
    // hostess: self only. owner/manager: optional hostess_membership_id param or all
    let targetMembershipIds: string[] = []

    if (authContext.role === "hostess") {
      targetMembershipIds = [authContext.membership_id]
    } else {
      const hostessMembershipId = url.searchParams.get("hostess_membership_id")
      if (hostessMembershipId) {
        targetMembershipIds = [hostessMembershipId]
      }
      // If empty, will query all hostesses
    }

    // 3. Get sessions for this business_day
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, started_at, ended_at, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    const sessionIds = (sessions ?? []).map(s => s.id)
    const sessionMap = new Map((sessions ?? []).map(s => [s.id, s]))

    if (sessionIds.length === 0) {
      return NextResponse.json({
        business_day_id: businessDayId,
        business_date: opDay.business_date,
        hostesses: [],
      })
    }

    // 4. Get participants
    let partQuery = supabase
      .from("session_participants")
      .select("id, session_id, membership_id, role, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at, left_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .in("session_id", sessionIds)

    if (targetMembershipIds.length > 0) {
      partQuery = partQuery.in("membership_id", targetMembershipIds)
    }

    const { data: participants } = await partQuery
    const participantList = participants ?? []

    // 5. Get hostess info
    const membershipIds = [...new Set(participantList.map(p => p.membership_id))]

    const { data: hostesses } = await supabase
      .from("hostesses")
      .select("membership_id, name, stage_name, category")
      .eq("store_uuid", authContext.store_uuid)
      .in("membership_id", membershipIds.length > 0 ? membershipIds : ["__none__"])

    const hostessMap = new Map((hostesses ?? []).map(h => [h.membership_id, h]))

    // 6. Group by hostess
    const groupMap = new Map<string, {
      membership_id: string
      name: string
      stage_name: string | null
      category: string | null
      sessions: {
        session_id: string
        room_uuid: string | null
        category: string
        time_minutes: number
        price_amount: number
        hostess_payout_amount: number
        status: string
        entered_at: string | null
        left_at: string | null
      }[]
      total_price: number
      total_payout: number
      total_sessions: number
    }>()

    for (const p of participantList) {
      const h = hostessMap.get(p.membership_id)
      if (!groupMap.has(p.membership_id)) {
        groupMap.set(p.membership_id, {
          membership_id: p.membership_id,
          name: h?.name ?? "unknown",
          stage_name: h?.stage_name ?? null,
          category: h?.category ?? null,
          sessions: [],
          total_price: 0,
          total_payout: 0,
          total_sessions: 0,
        })
      }
      const entry = groupMap.get(p.membership_id)!
      const sess = sessionMap.get(p.session_id)
      entry.sessions.push({
        session_id: p.session_id,
        room_uuid: sess?.room_uuid ?? null,
        category: p.category,
        time_minutes: p.time_minutes,
        price_amount: p.price_amount ?? 0,
        hostess_payout_amount: p.hostess_payout_amount ?? 0,
        status: p.status,
        entered_at: p.entered_at,
        left_at: p.left_at,
      })
      entry.total_price += p.price_amount ?? 0
      entry.total_payout += p.hostess_payout_amount ?? 0
      entry.total_sessions += 1
    }

    return NextResponse.json({
      business_day_id: businessDayId,
      business_date: opDay.business_date,
      hostesses: [...groupMap.values()],
    })

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
