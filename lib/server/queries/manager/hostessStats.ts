import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export type ManagerHostessStatsResponse = {
  store_uuid: string
  scope: "manager" | "store"
  managed_total: number
  on_duty_count: number
  waiting_count: number
  in_room_count: number
}

export async function getManagerHostessStats(auth: AuthContext): Promise<ManagerHostessStatsResponse> {
  const supabase = getServiceClient()

  let hostessQuery = supabase
    .from("hostesses")
    .select("membership_id")
    .eq("store_uuid", auth.store_uuid)
    .eq("is_active", true)
    .is("deleted_at", null)

  if (auth.role === "manager") {
    hostessQuery = hostessQuery.eq("manager_membership_id", auth.membership_id)
  }

  const { data: hostesses, error: hostessError } = await hostessQuery

  if (hostessError) {
    console.error("[hostess-stats] hostess query failed:", hostessError.message)
    throw new Error("QUERY_FAILED")
  }

  const managedMembershipIds = (hostesses ?? []).map(
    (h: { membership_id: string }) => h.membership_id,
  )
  const managedTotal = managedMembershipIds.length
  const scope: "manager" | "store" = auth.role === "manager" ? "manager" : "store"

  if (managedTotal === 0) {
    return {
      store_uuid: auth.store_uuid,
      scope,
      managed_total: 0,
      on_duty_count: 0,
      waiting_count: 0,
      in_room_count: 0,
    }
  }

  const today = getBusinessDateForOps()
  let { data: bizDay } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_date", today)
    .maybeSingle()

  if (!bizDay) {
    const { data: latestDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "open")
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle()
    bizDay = latestDay
  }

  if (!bizDay) {
    return {
      store_uuid: auth.store_uuid,
      scope,
      managed_total: managedTotal,
      on_duty_count: 0,
      waiting_count: 0,
      in_room_count: 0,
    }
  }

  const { data: attendance } = await supabase
    .from("staff_attendance")
    .select("membership_id, status")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_day_id", bizDay.id)
    .in("membership_id", managedMembershipIds)
    .in("status", ["available", "assigned", "in_room"])

  const attendanceSet = new Set(
    (attendance ?? []).map((a: { membership_id: string }) => a.membership_id),
  )
  const statusMap = new Map<string, string>()
  for (const a of attendance ?? []) {
    statusMap.set((a as { membership_id: string }).membership_id, (a as { status: string }).status)
  }

  const onDutyCount = attendanceSet.size
  const waitingCount = [...statusMap.values()].filter(s => s === "available").length
  const inRoomCount = [...statusMap.values()].filter(s => s === "in_room" || s === "assigned").length

  return {
    store_uuid: auth.store_uuid,
    scope,
    managed_total: managedTotal,
    on_duty_count: onDutyCount,
    waiting_count: waitingCount,
    in_room_count: inRoomCount,
  }
}
