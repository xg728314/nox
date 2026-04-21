import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { resolveStoreNames, resolveHostessNames } from "@/lib/cross-store/queries/loadCrossStoreScoped"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess cannot view cross-store work records." },
        { status: 403 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get("scope") || "working"
    const statusFilter = searchParams.get("status")
    const businessDayId = searchParams.get("business_day_id")

    let query = supabase
      .from("cross_store_work_records")
      .select("id, session_id, business_day_id, working_store_uuid, origin_store_uuid, hostess_membership_id, requested_by, approved_by, approved_at, status, reject_reason, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (scope === "origin") {
      query = query.eq("origin_store_uuid", authContext.store_uuid)
    } else {
      query = query.eq("working_store_uuid", authContext.store_uuid)
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter)
    }
    if (businessDayId) {
      query = query.eq("business_day_id", businessDayId)
    }

    const { data: records, error: queryError } = await query

    if (queryError) {
      return NextResponse.json({ error: "QUERY_FAILED", message: queryError.message }, { status: 500 })
    }

    // Enrich with hostess + store names
    const hostessIds = [...new Set((records ?? []).map((r: { hostess_membership_id: string }) => r.hostess_membership_id))]
    const nameMap = await resolveHostessNames(supabase, authContext.store_uuid, hostessIds)

    const storeIds = new Set<string>()
    for (const r of records ?? []) {
      storeIds.add(r.working_store_uuid)
      storeIds.add(r.origin_store_uuid)
    }
    const storeNameMap = await resolveStoreNames(supabase, [...storeIds])

    const enrichedRecords = (records ?? []).map((r: {
      id: string; session_id: string; business_day_id: string
      working_store_uuid: string; origin_store_uuid: string; hostess_membership_id: string
      requested_by: string; approved_by: string | null; approved_at: string | null
      status: string; reject_reason: string | null; created_at: string
    }) => ({
      ...r,
      hostess_name: nameMap.get(r.hostess_membership_id) || null,
      working_store_name: storeNameMap.get(r.working_store_uuid) || null,
      origin_store_name: storeNameMap.get(r.origin_store_uuid) || null,
    }))

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      scope,
      count: enrichedRecords.length,
      records: enrichedRecords,
    })
  } catch (error) {
    return handleRouteError(error, "cross-store/records")
  }
}
