import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner, manager
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
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

    // 0. Resolve business_day_id: query param → today → latest open fallback
    const { searchParams } = new URL(request.url)
    const paramBusinessDayId = searchParams.get("business_day_id")

    let businessDayId: string | null = paramBusinessDayId

    if (!businessDayId) {
      const today = new Date().toISOString().split("T")[0]
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_date", today)
        .maybeSingle()

      businessDayId = bizDay?.id ?? null

      // Fallback: most recent open business day
      if (!businessDayId) {
        const { data: latestDay } = await supabase
          .from("store_operating_days")
          .select("id")
          .eq("store_uuid", authContext.store_uuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()

        businessDayId = latestDay?.id ?? null
      }
    }

    if (!businessDayId) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        business_day_id: null,
        summary: [],
      })
    }

    // 1. Get hostess IDs (owner: all, manager: assigned only)
    let hostessIds: string[] = []

    if (authContext.role === "owner") {
      const { data: allHostesses, error: allError } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("role", "hostess")
        .eq("status", "approved")

      if (allError) {
        return NextResponse.json(
          { error: "QUERY_FAILED", message: "Failed to query hostesses." },
          { status: 500 }
        )
      }
      hostessIds = (allHostesses ?? []).map((h: { id: string }) => h.id)
    } else {
      // Manager sees only assigned hostesses
      const { data: assignments, error: assignmentsError } = await supabase
        .from("hostesses")
        .select("membership_id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("manager_membership_id", authContext.membership_id)

      if (assignmentsError) {
        return NextResponse.json(
          { error: "QUERY_FAILED", message: "Failed to query hostess assignments." },
          { status: 500 }
        )
      }
      hostessIds = (assignments ?? []).map((a: { membership_id: string }) => a.membership_id)
    }

    if (hostessIds.length === 0) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        business_day_id: businessDayId,
        summary: [],
      })
    }

    // 2. Lookup hostess names
    const nameMap = new Map<string, string>()
    const { data: hsts } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .eq("store_uuid", authContext.store_uuid)
      .in("membership_id", hostessIds)

    for (const h of hsts ?? []) nameMap.set(h.membership_id, h.name)

    // 3. Get all sessions for this business_day
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)

    if (sessionIds.length === 0) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        business_day_id: businessDayId,
        summary: hostessIds.map((id: string) => ({
          hostess_id: id,
          hostess_name: nameMap.get(id) || "",
          has_settlement: false,
          status: null,
          gross_total: null,
          tc_amount: null,
          manager_amount: null,
          hostess_amount: null,
        })),
      })
    }

    // 4. Get all participations for these sessions (scoped to target hostesses)
    const { data: participations } = await supabase
      .from("session_participants")
      .select("membership_id, session_id")
      .eq("store_uuid", authContext.store_uuid)
      .in("session_id", sessionIds)
      .in("membership_id", hostessIds)
      .is("deleted_at", null)

    // Build map: hostess_id -> set of session_ids
    const hostessSessionMap = new Map<string, Set<string>>()
    for (const p of participations ?? []) {
      if (!hostessSessionMap.has(p.membership_id)) {
        hostessSessionMap.set(p.membership_id, new Set())
      }
      hostessSessionMap.get(p.membership_id)!.add(p.session_id)
    }

    // 5. Get all receipts for this business_day
    const { data: receipts } = await supabase
      .from("receipts")
      .select("session_id, status, gross_total, tc_amount, manager_amount, hostess_amount")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    // Build map: session_id -> receipt
    const receiptMap = new Map<string, { status: string; gross_total: number; tc_amount: number; manager_amount: number; hostess_amount: number }>()
    for (const r of receipts ?? []) {
      receiptMap.set(r.session_id, r)
    }

    // 6. Build summary: for each hostess, aggregate all sessions in this business_day
    const summary = hostessIds.map((hostessId: string) => {
      const hostessSessions = hostessSessionMap.get(hostessId)

      if (!hostessSessions || hostessSessions.size === 0) {
        return {
          hostess_id: hostessId,
          hostess_name: nameMap.get(hostessId) || "",
          has_settlement: false,
          status: null,
          gross_total: null,
          tc_amount: null,
          manager_amount: null,
          hostess_amount: null,
        }
      }

      // Aggregate receipts across all sessions this hostess participated in
      let totalGross = 0
      let totalTc = 0
      let totalManager = 0
      let totalHostess = 0
      let settledCount = 0
      let finalizedCount = 0
      let draftCount = 0

      for (const sid of hostessSessions) {
        const receipt = receiptMap.get(sid)
        if (receipt) {
          settledCount++
          totalGross += receipt.gross_total ?? 0
          totalTc += receipt.tc_amount ?? 0
          totalManager += receipt.manager_amount ?? 0
          totalHostess += receipt.hostess_amount ?? 0
          if (receipt.status === "finalized") finalizedCount++
          if (receipt.status === "draft") draftCount++
        }
      }

      const hasSettlement = settledCount > 0
      let aggregateStatus: string | null = null
      if (finalizedCount === settledCount && settledCount > 0) {
        aggregateStatus = "finalized"
      } else if (settledCount > 0) {
        aggregateStatus = "draft"
      }

      return {
        hostess_id: hostessId,
        hostess_name: nameMap.get(hostessId) || "",
        has_settlement: hasSettlement,
        status: aggregateStatus,
        gross_total: hasSettlement ? totalGross : null,
        tc_amount: hasSettlement ? totalTc : null,
        manager_amount: hasSettlement ? totalManager : null,
        hostess_amount: hasSettlement ? totalHostess : null,
      }
    })

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      business_day_id: businessDayId,
      summary,
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
