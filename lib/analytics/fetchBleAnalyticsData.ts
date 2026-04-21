import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Shared read-only loader for BLE analytics routes.
 *
 * Applies: date window, store filter, gateway, reason, corrected_by,
 * zone_from/zone_to, and floor (client-side intersect against room_uuid
 * lookups because corrections/feedback do not denormalize floor_no).
 *
 * Row cap defaults to 5 000 per source. For windows larger than a week
 * an operator-friendly warning can be surfaced from the consuming route
 * when either array is saturated.
 */

export function analyticsSupa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export type AnalyticsCorrectionRow = {
  id: string
  store_uuid: string
  membership_id: string
  session_id: string | null
  participant_id: string | null
  original_zone: string
  corrected_zone: string
  original_room_uuid: string | null
  corrected_room_uuid: string | null
  gateway_id: string | null
  reason: string | null
  note: string | null
  corrected_by_membership_id: string
  corrected_at: string
}

export type AnalyticsFeedbackRow = {
  id: string
  store_uuid: string
  membership_id: string
  participant_id: string | null
  session_id: string | null
  feedback_type: string
  zone: string | null
  room_uuid: string | null
  gateway_id: string | null
  source: string
  note: string | null
  by_membership_id: string
  created_at: string
}

export type BleAnalyticsFilters = {
  from: string
  to: string
  floor: number | null
  gateway_id: string | null
  reason: string | null
  corrected_by: string | null
  zone_from: string | null
  zone_to: string | null
}

const CORR_COLS =
  "id, store_uuid, membership_id, session_id, participant_id, original_zone, corrected_zone, original_room_uuid, corrected_room_uuid, gateway_id, reason, note, corrected_by_membership_id, corrected_at"
const FB_COLS =
  "id, store_uuid, membership_id, participant_id, session_id, feedback_type, zone, room_uuid, gateway_id, source, note, by_membership_id, created_at"

export async function fetchBleAnalyticsData(
  supabase: SupabaseClient,
  storeFilter: string | null,
  f: BleAnalyticsFilters,
  limit = 5000,
): Promise<{
  corrections: AnalyticsCorrectionRow[]
  feedback: AnalyticsFeedbackRow[]
  floorRoomUuids: Set<string> | null
  saturated: boolean
}> {
  // 1. Floor filter resolution — fetch rooms matching floor_no in scope.
  let floorRoomUuids: Set<string> | null = null
  if (f.floor !== null) {
    let rq = supabase.from("rooms").select("id").eq("floor_no", f.floor).is("deleted_at", null)
    if (storeFilter) rq = rq.eq("store_uuid", storeFilter)
    const { data: rrs } = await rq
    floorRoomUuids = new Set((rrs ?? []).map((r: { id: string }) => r.id))
    if (floorRoomUuids.size === 0) {
      return { corrections: [], feedback: [], floorRoomUuids, saturated: false }
    }
  }

  // 2. Corrections.
  let cq = supabase
    .from("ble_presence_corrections")
    .select(CORR_COLS)
    .gte("corrected_at", f.from)
    .lte("corrected_at", f.to)
    .order("corrected_at", { ascending: false })
    .limit(limit)
  if (storeFilter) cq = cq.eq("store_uuid", storeFilter)
  if (f.gateway_id) cq = cq.eq("gateway_id", f.gateway_id)
  if (f.reason) cq = cq.eq("reason", f.reason)
  if (f.corrected_by) cq = cq.eq("corrected_by_membership_id", f.corrected_by)
  if (f.zone_from) cq = cq.eq("original_zone", f.zone_from)
  if (f.zone_to) cq = cq.eq("corrected_zone", f.zone_to)
  const { data: cData } = await cq
  let corrections = (cData ?? []) as AnalyticsCorrectionRow[]

  if (floorRoomUuids) {
    corrections = corrections.filter(
      c => (c.original_room_uuid && floorRoomUuids!.has(c.original_room_uuid)) ||
           (c.corrected_room_uuid && floorRoomUuids!.has(c.corrected_room_uuid)),
    )
  }

  // 3. Feedback.
  let fq = supabase
    .from("ble_feedback")
    .select(FB_COLS)
    .gte("created_at", f.from)
    .lte("created_at", f.to)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (storeFilter) fq = fq.eq("store_uuid", storeFilter)
  if (f.gateway_id) fq = fq.eq("gateway_id", f.gateway_id)
  if (f.zone_from) fq = fq.eq("zone", f.zone_from)
  if (f.corrected_by) fq = fq.eq("by_membership_id", f.corrected_by)
  const { data: fData } = await fq
  let feedback = (fData ?? []) as AnalyticsFeedbackRow[]

  if (floorRoomUuids) {
    feedback = feedback.filter(r => r.room_uuid && floorRoomUuids!.has(r.room_uuid))
  }

  const saturated = corrections.length >= limit || feedback.length >= limit
  return { corrections, feedback, floorRoomUuids, saturated }
}
