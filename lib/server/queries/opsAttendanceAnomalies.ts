import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * ROUND-ALERT-1: /api/ops/attendance-overview 에서 쓰던 이상 감지 로직을
 * 순수 server helper 로 분리. route 응답과 cron 알림 스캔이 동일한 계산을
 * 쓰도록 한다.
 *
 * 어떤 write 도 하지 않는다. `supabase`, `storeUuid` 만 받는다.
 */

const BLE_WINDOW_MIN = 10
const RECENT_CHECKOUT_WINDOW_MIN = 60
const SAMPLE_LIMIT = 20

export type OpsAttendanceOverview = {
  store_uuid: string
  business_day_id: string | null
  attendance: { total: number; checked_in: number; checked_out: number }
  ble: { live_count: number; auto_checkin_count: number }
  anomalies: {
    duplicate_open: number
    recent_checkout_block: number
    tag_mismatch: number
    no_business_day: number
  }
  sample: {
    duplicate_membership_ids: string[]
    mismatch_membership_ids: string[]
    no_tag_membership_ids: string[]
    recent_checkout_block_ids: string[]
    no_business_day_ids: string[]
  }
  generated_at: string
  window_min: number
}

export async function computeAttendanceAnomalies(
  supabase: SupabaseClient,
  storeUuid: string,
): Promise<OpsAttendanceOverview> {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const bleWindowStart = new Date(nowMs - BLE_WINDOW_MIN * 60 * 1000).toISOString()
  const recentCheckoutStart = new Date(
    nowMs - RECENT_CHECKOUT_WINDOW_MIN * 60 * 1000,
  ).toISOString()

  const today = nowIso.slice(0, 10)
  const { data: bizDayRow } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("business_date", today)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle()
  const businessDayId = (bizDayRow as { id: string } | null)?.id ?? null

  type AttRow = {
    membership_id: string
    checked_out_at: string | null
    notes: string | null
  }
  let attendanceRows: AttRow[] = []
  if (businessDayId) {
    const { data: attRaw } = await supabase
      .from("staff_attendance")
      .select("membership_id, checked_out_at, notes")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
    attendanceRows = (attRaw ?? []) as AttRow[]
  }
  const total = attendanceRows.length
  const checkedIn = attendanceRows.filter((a) => a.checked_out_at === null).length
  const checkedOut = attendanceRows.filter((a) => a.checked_out_at !== null).length
  const autoCheckinCount = attendanceRows.filter(
    (a) => typeof a.notes === "string" && a.notes.includes("source:ble"),
  ).length

  const openCountByMember = new Map<string, number>()
  for (const a of attendanceRows) {
    if (a.checked_out_at === null) {
      openCountByMember.set(
        a.membership_id,
        (openCountByMember.get(a.membership_id) ?? 0) + 1,
      )
    }
  }
  const duplicateMembers = [...openCountByMember.entries()]
    .filter(([, c]) => c > 1)
    .map(([m]) => m)

  const { data: bleRaw } = await supabase
    .from("ble_presence_history")
    .select("membership_id")
    .eq("store_uuid", storeUuid)
    .gte("seen_at", bleWindowStart)
    .lte("seen_at", nowIso)
    .not("membership_id", "is", null)
    .limit(2000)
  const bleLiveIds = Array.from(
    new Set(
      ((bleRaw ?? []) as { membership_id: string }[])
        .map((r) => r.membership_id)
        .filter((v): v is string => !!v),
    ),
  )
  const bleLiveCount = bleLiveIds.length

  let mismatchIds: string[] = []
  if (bleLiveIds.length > 0) {
    const { data: tagRows } = await supabase
      .from("ble_tags")
      .select("membership_id")
      .eq("store_uuid", storeUuid)
      .eq("is_active", true)
      .in("membership_id", bleLiveIds)
    const validSet = new Set(
      ((tagRows ?? []) as { membership_id: string }[]).map((t) => t.membership_id),
    )
    mismatchIds = bleLiveIds.filter((id) => !validSet.has(id))
  }

  let recentCheckoutBlockIds: string[] = []
  if (businessDayId && bleLiveIds.length > 0) {
    const { data: recentOut } = await supabase
      .from("staff_attendance")
      .select("membership_id")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
      .not("checked_out_at", "is", null)
      .gte("checked_out_at", recentCheckoutStart)
      .in("membership_id", bleLiveIds)
    const recentOutSet = new Set(
      ((recentOut ?? []) as { membership_id: string }[]).map((r) => r.membership_id),
    )
    recentCheckoutBlockIds = bleLiveIds.filter((id) => recentOutSet.has(id))
  }

  const noBusinessDayIds =
    !businessDayId && bleLiveIds.length > 0 ? bleLiveIds : []

  return {
    store_uuid: storeUuid,
    business_day_id: businessDayId,
    attendance: { total, checked_in: checkedIn, checked_out: checkedOut },
    ble: { live_count: bleLiveCount, auto_checkin_count: autoCheckinCount },
    anomalies: {
      duplicate_open: duplicateMembers.length,
      recent_checkout_block: recentCheckoutBlockIds.length,
      tag_mismatch: mismatchIds.length,
      no_business_day: noBusinessDayIds.length,
    },
    sample: {
      duplicate_membership_ids: duplicateMembers.slice(0, SAMPLE_LIMIT),
      mismatch_membership_ids: mismatchIds.slice(0, SAMPLE_LIMIT),
      no_tag_membership_ids: mismatchIds.slice(0, SAMPLE_LIMIT),
      recent_checkout_block_ids: recentCheckoutBlockIds.slice(0, SAMPLE_LIMIT),
      no_business_day_ids: noBusinessDayIds.slice(0, SAMPLE_LIMIT),
    },
    generated_at: nowIso,
    window_min: BLE_WINDOW_MIN,
  }
}
