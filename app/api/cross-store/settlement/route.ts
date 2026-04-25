import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { resolveStoreNames, resolveHostessNames } from "@/lib/cross-store/queries/loadCrossStoreScoped"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/cross-store/settlement?business_date=2026-04-12
 * 내 매장(origin_store) 소속 스태프가 타매장에서 근무한 정산 내역.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // business_date 결정
    const { searchParams } = new URL(request.url)
    let businessDate: string | null = searchParams.get("business_date")

    if (!businessDate) {
      const today = getBusinessDateForOps()
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("business_date")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_date", today)
        .maybeSingle()

      if (bizDay) {
        businessDate = bizDay.business_date
      } else {
        const { data: latestDay } = await supabase
          .from("store_operating_days")
          .select("business_date")
          .eq("store_uuid", authContext.store_uuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()
        businessDate = latestDay?.business_date ?? today
      }
    }

    // 1. 해당 날짜의 모든 워킹매장 영업일 ID 수집
    const { data: allBizDays } = await supabase
      .from("store_operating_days")
      .select("id, store_uuid")
      .eq("business_date", businessDate)

    const allBizDayIds = (allBizDays ?? []).map((b: { id: string }) => b.id)

    if (allBizDayIds.length === 0) {
      return NextResponse.json({
        origin_store_uuid: authContext.store_uuid,
        business_date: businessDate,
        records: [],
        summary: { total_payout: 0, count: 0 },
      })
    }

    // 2. 내 매장 소속 스태프의 CSWR 조회
    const { data: workRecords } = await supabase
      .from("cross_store_work_records")
      .select("id, session_id, working_store_uuid, hostess_membership_id, status")
      .eq("origin_store_uuid", authContext.store_uuid)
      .in("business_day_id", allBizDayIds)
      .is("deleted_at", null)

    if (!workRecords || workRecords.length === 0) {
      return NextResponse.json({
        origin_store_uuid: authContext.store_uuid,
        business_date: businessDate,
        records: [],
        summary: { total_payout: 0, count: 0 },
      })
    }

    // 3. 해당 세션의 참여자 내역
    const sessionIds = [...new Set(workRecords.map((r: { session_id: string }) => r.session_id))]
    const hostessIds = [...new Set(workRecords.map((r: { hostess_membership_id: string }) => r.hostess_membership_id))]

    const { data: participants } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, category, time_minutes, price_amount, hostess_payout_amount, origin_store_uuid, status")
      .in("session_id", sessionIds)
      .in("membership_id", hostessIds)
      .is("deleted_at", null)

    const filtered = (participants ?? []).filter((p: { membership_id: string; origin_store_uuid: string | null }) =>
      hostessIds.includes(p.membership_id)
    )

    // 4. Store + hostess name resolution
    const workingStoreUuids = [...new Set(workRecords.map((r: { working_store_uuid: string }) => r.working_store_uuid))]
    const storeNameMap = await resolveStoreNames(supabase, workingStoreUuids)
    const nameMap = await resolveHostessNames(supabase, authContext.store_uuid, hostessIds)

    // 5. session → working_store 매핑
    const sessionWorkingMap = new Map<string, string>()
    for (const wr of workRecords) {
      sessionWorkingMap.set(wr.session_id, wr.working_store_uuid)
    }

    const records = filtered.map((p: {
      id: string; session_id: string; membership_id: string; category: string;
      time_minutes: number; price_amount: number; hostess_payout_amount: number;
      origin_store_uuid: string | null; status: string
    }) => ({
      participant_id: p.id,
      session_id: p.session_id,
      membership_id: p.membership_id,
      hostess_name: nameMap.get(p.membership_id) || null,
      category: p.category,
      time_minutes: p.time_minutes,
      price_amount: p.price_amount,
      hostess_payout: p.hostess_payout_amount,
      working_store_uuid: sessionWorkingMap.get(p.session_id) || null,
      working_store_name: storeNameMap.get(sessionWorkingMap.get(p.session_id) || "") || null,
    }))

    const totalPayout = records.reduce((sum: number, r: { hostess_payout: number }) => sum + r.hostess_payout, 0)

    return NextResponse.json({
      origin_store_uuid: authContext.store_uuid,
      business_date: businessDate,
      records,
      summary: { total_payout: totalPayout, count: records.length },
    })
  } catch (error) {
    return handleRouteError(error, "cross-store/settlement")
  }
}
