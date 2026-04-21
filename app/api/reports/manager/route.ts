import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view manager reports." },
        { status: 403 }
      )
    }

    const url = new URL(request.url)
    const businessDayId = url.searchParams.get("business_day_id")
    const managerMembershipId = url.searchParams.get("manager_membership_id")

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

    // 2. Get sessions for this business_day
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    const sessionIds = (sessions ?? []).map(s => s.id)

    if (sessionIds.length === 0) {
      return NextResponse.json({
        business_day_id: businessDayId,
        business_date: opDay.business_date,
        managers: [],
      })
    }

    // 3. Get managers list
    let managersQuery = supabase
      .from("managers")
      .select("id, membership_id, name, nickname")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)

    if (managerMembershipId) {
      managersQuery = managersQuery.eq("membership_id", managerMembershipId)
    }

    const { data: managers } = await managersQuery
    const managerList = managers ?? []

    // If manager role, only show self
    let filteredManagers = managerList
    if (authContext.role === "manager") {
      filteredManagers = managerList.filter(m => m.membership_id === authContext.membership_id)
    }

    // 4. Get all participants for these sessions
    const { data: allParticipants } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status")
      .eq("store_uuid", authContext.store_uuid)
      .in("session_id", sessionIds)

    const participantList = allParticipants ?? []

    // 5. Get hostesses with manager_membership_id mapping
    const { data: hostesses } = await supabase
      .from("hostesses")
      .select("id, membership_id, manager_membership_id, name, stage_name")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)

    const hostessMap = new Map((hostesses ?? []).map(h => [h.membership_id, h]))

    // 6. Build manager reports
    const managerReports = filteredManagers.map(mgr => {
      // Manager's own participations
      const mgrParticipations = participantList.filter(
        p => p.membership_id === mgr.membership_id && p.role === "manager"
      )
      const mgrTotalPayout = mgrParticipations.reduce((s, p) => s + (p.manager_payout_amount ?? 0), 0)
      const mgrTotalPrice = mgrParticipations.reduce((s, p) => s + (p.price_amount ?? 0), 0)

      // Hostesses under this manager
      const assignedHostesses = (hostesses ?? []).filter(h => h.manager_membership_id === mgr.membership_id)
      const assignedMembershipIds = assignedHostesses.map(h => h.membership_id)

      const hostessParticipations = participantList.filter(
        p => assignedMembershipIds.includes(p.membership_id) && p.role === "hostess"
      )

      // Group by hostess
      const hostessDetailMap = new Map<string, {
        membership_id: string
        name: string
        stage_name: string | null
        sessions: number
        total_price: number
        total_payout: number
      }>()

      for (const p of hostessParticipations) {
        const h = hostessMap.get(p.membership_id)
        if (!hostessDetailMap.has(p.membership_id)) {
          hostessDetailMap.set(p.membership_id, {
            membership_id: p.membership_id,
            name: h?.name ?? "unknown",
            stage_name: h?.stage_name ?? null,
            sessions: 0,
            total_price: 0,
            total_payout: 0,
          })
        }
        const entry = hostessDetailMap.get(p.membership_id)!
        entry.sessions += 1
        entry.total_price += p.price_amount ?? 0
        entry.total_payout += p.hostess_payout_amount ?? 0
      }

      return {
        manager_membership_id: mgr.membership_id,
        name: mgr.name,
        nickname: mgr.nickname,
        manager_sessions: mgrParticipations.length,
        manager_total_price: mgrTotalPrice,
        manager_total_payout: mgrTotalPayout,
        assigned_hostess_count: assignedHostesses.length,
        hostess_details: [...hostessDetailMap.values()],
      }
    })

    return NextResponse.json({
      business_day_id: businessDayId,
      business_date: opDay.business_date,
      managers: managerReports,
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
