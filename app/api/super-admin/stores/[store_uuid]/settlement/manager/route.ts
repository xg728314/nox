import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveAdminScope } from "@/lib/auth/resolveAdminScope"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/super-admin/stores/[store_uuid]/settlement/manager
 *
 * Manager-side settlement summary for a target store. super_admin-gated.
 * Mirrors /api/manager/settlement/summary query shape but scoped to the
 * store provided in the path, returning per-manager aggregates grouped
 * from the same tables (no new calculation).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { store_uuid: pathStoreUuid } = await params
    const scope = await resolveAdminScope({
      auth: authContext,
      supabase,
      request,
      screen: "super-admin/settlement-manager",
      requiredTargetFromPath: pathStoreUuid,
      actionKind: "read",
      actionDetail: "manager_settlement_read",
    })
    if (!scope.ok) return scope.error
    const storeUuid = scope.scopeStoreUuid

    // Resolve business_day_id
    const { searchParams } = new URL(request.url)
    let businessDayId: string | null = searchParams.get("business_day_id")
    if (!businessDayId) {
      const today = new Date().toISOString().split("T")[0]
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", storeUuid)
        .eq("business_date", today)
        .maybeSingle()
      businessDayId = bizDay?.id ?? null
      if (!businessDayId) {
        const { data: latestDay } = await supabase
          .from("store_operating_days")
          .select("id")
          .eq("store_uuid", storeUuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()
        businessDayId = latestDay?.id ?? null
      }
    }

    if (!businessDayId) {
      return NextResponse.json({
        store_uuid: storeUuid,
        business_day_id: null,
        managers: [],
      })
    }

    // 1) Manager memberships for this store
    const { data: managerRows } = await supabase
      .from("store_memberships")
      .select("id, profile_id")
      .eq("store_uuid", storeUuid)
      .eq("role", "manager")
      .eq("status", "approved")
      .is("deleted_at", null)
    const managerIds = (managerRows ?? []).map((m: { id: string }) => m.id)

    const { data: managerInfo } = await supabase
      .from("managers")
      .select("membership_id, name")
      .eq("store_uuid", storeUuid)
    const mgrNameMap = new Map<string, string>()
    for (const m of managerInfo ?? []) mgrNameMap.set(m.membership_id as string, m.name as string)

    // 2) Hostess → manager mapping (via hostesses table)
    const { data: hostesses } = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id, name")
      .eq("store_uuid", storeUuid)
    const hostessByManager = new Map<string, Set<string>>()
    for (const h of hostesses ?? []) {
      const mgr = (h.manager_membership_id as string) ?? ""
      if (!mgr) continue
      if (!hostessByManager.has(mgr)) hostessByManager.set(mgr, new Set())
      hostessByManager.get(mgr)!.add(h.membership_id as string)
    }

    // 3) Today's sessions for this store
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)

    if (sessionIds.length === 0 || managerIds.length === 0) {
      return NextResponse.json({
        store_uuid: storeUuid,
        business_day_id: businessDayId,
        managers: managerIds.map((mid: string) => ({
          manager_membership_id: mid,
          manager_name: mgrNameMap.get(mid) ?? "",
          hostess_count: hostessByManager.get(mid)?.size ?? 0,
          settlement_sessions: 0,
          total_gross: 0,
          total_manager_amount: 0,
          total_hostess_amount: 0,
          finalized_count: 0,
          draft_count: 0,
        })),
      })
    }

    // 4) Participants per session with their manager_membership_id
    const { data: participations } = await supabase
      .from("session_participants")
      .select("session_id, membership_id, manager_membership_id")
      .eq("store_uuid", storeUuid)
      .in("session_id", sessionIds)
      .is("deleted_at", null)

    // 5) Receipts (latest per session)
    const { data: receipts } = await supabase
      .from("receipts")
      .select("session_id, status, gross_total, manager_amount, hostess_amount, version")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
      .order("version", { ascending: false })
    const latestReceipt = new Map<string, { status: string; gross_total: number; manager_amount: number; hostess_amount: number }>()
    for (const r of receipts ?? []) {
      if (!latestReceipt.has(r.session_id as string)) {
        latestReceipt.set(r.session_id as string, {
          status: r.status as string,
          gross_total: (r.gross_total as number) ?? 0,
          manager_amount: (r.manager_amount as number) ?? 0,
          hostess_amount: (r.hostess_amount as number) ?? 0,
        })
      }
    }

    // 6) Build manager → (sessions they own) map.
    //    A session is attributed to a manager if ANY participant in that
    //    session has manager_membership_id = that manager. Conservative —
    //    matches how owner/manager settlement views already aggregate.
    const sessionsByManager = new Map<string, Set<string>>()
    for (const p of participations ?? []) {
      const mgr = (p.manager_membership_id as string) ?? ""
      const sid = p.session_id as string
      if (!mgr || !sid) continue
      if (!sessionsByManager.has(mgr)) sessionsByManager.set(mgr, new Set())
      sessionsByManager.get(mgr)!.add(sid)
    }

    const managersOut = managerIds.map((mid: string) => {
      const theirSessions = sessionsByManager.get(mid) ?? new Set<string>()
      let gross = 0
      let mgrAmt = 0
      let hstAmt = 0
      let finalized = 0
      let draft = 0
      for (const sid of theirSessions) {
        const r = latestReceipt.get(sid)
        if (!r) continue
        gross += r.gross_total
        mgrAmt += r.manager_amount
        hstAmt += r.hostess_amount
        if (r.status === "finalized") finalized++
        else if (r.status === "draft") draft++
      }
      return {
        manager_membership_id: mid,
        manager_name: mgrNameMap.get(mid) ?? "",
        hostess_count: hostessByManager.get(mid)?.size ?? 0,
        settlement_sessions: theirSessions.size,
        total_gross: gross,
        total_manager_amount: mgrAmt,
        total_hostess_amount: hstAmt,
        finalized_count: finalized,
        draft_count: draft,
      }
    })

    return NextResponse.json({
      store_uuid: storeUuid,
      business_day_id: businessDayId,
      managers: managersOut,
      viewer: { is_super_admin: true, cross_store: scope.isCrossStore },
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
