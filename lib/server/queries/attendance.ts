import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"

export type AttendanceRecord = {
  id: string
  membership_id: string
  role: string
  status: string
  checked_in_at: string
  checked_out_at: string | null
  assigned_room_uuid: string | null
  notes: string | null
  name: string
  room_name: string | null
}

export type AttendanceResponse = {
  store_uuid: string
  business_day_id: string | null
  attendance: AttendanceRecord[]
  // ROUND-STAFF-3: 최근 10분 내 BLE presence_history 에 잡힌 membership_id.
  //   attendance 상태와 독립적인 참고 정보. 누락/미설치 시 빈 배열.
  ble_live_ids?: string[]
}

export async function getAttendance(
  auth: AuthContext,
  opts: { visibilityMode?: "mine_only" | "store_shared" } = {},
): Promise<AttendanceResponse> {
  const supabase = getServiceClient()
  const visibilityMode = opts.visibilityMode ?? "mine_only"

  const today = new Date().toISOString().split("T")[0]
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

    if (!latestDay) {
      return { store_uuid: auth.store_uuid, business_day_id: null, attendance: [], ble_live_ids: [] }
    }
    bizDay = latestDay
  }

  const businessDayId = bizDay.id

  type AttendanceRow = {
    id: string; membership_id: string; role: string; status: string;
    checked_in_at: string; checked_out_at: string | null;
    assigned_room_uuid: string | null; notes: string | null
  }

  const { data: attendance, error } = await supabase
    .from("staff_attendance")
    .select("id, membership_id, role, status, checked_in_at, checked_out_at, assigned_room_uuid, notes")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_day_id", businessDayId)
    .order("checked_in_at", { ascending: true })

  if (error) throw new Error(error.message)

  const membershipIds = [...new Set((attendance ?? []).map((a: AttendanceRow) => a.membership_id))]
  const nameMap = new Map<string, string>()

  if (membershipIds.length > 0) {
    const { data: managers } = await supabase.from("managers").select("membership_id, name").eq("store_uuid", auth.store_uuid).in("membership_id", membershipIds)
    for (const m of managers ?? []) nameMap.set(m.membership_id, m.name)
    const { data: hostesses } = await supabase.from("hostesses").select("membership_id, name").eq("store_uuid", auth.store_uuid).in("membership_id", membershipIds)
    for (const h of hostesses ?? []) nameMap.set(h.membership_id, h.name)
  }

  const roomUuids = [...new Set((attendance ?? []).map((a: AttendanceRow) => a.assigned_room_uuid).filter(Boolean))] as string[]
  const roomMap = new Map<string, string>()
  if (roomUuids.length > 0) {
    const { data: rooms } = await supabase.from("rooms").select("id, room_name, room_no").eq("store_uuid", auth.store_uuid).in("id", roomUuids)
    for (const r of rooms ?? []) roomMap.set(r.id, formatRoomLabel(r))
  }

  const enriched: AttendanceRecord[] = (attendance ?? []).map((a: AttendanceRow) => ({
    ...a,
    name: nameMap.get(a.membership_id) || "",
    room_name: a.assigned_room_uuid ? (roomMap.get(a.assigned_room_uuid) || null) : null,
  }))

  // ROUND-STAFF-3: BLE live presence — 최근 10분 내 ble_presence_history 에
  //   같은 매장에서 감지된 membership_id 목록. UI 에 "근무중 (BLE)" 배지로 쓰임.
  //   attendance 상태 / 조작 권한과는 **완전히 독립적인 참고 정보**.
  const bleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: bleRows } = await supabase
    .from("ble_presence_history")
    .select("membership_id")
    .eq("store_uuid", auth.store_uuid)
    .gte("seen_at", bleCutoff)
    .not("membership_id", "is", null)
    .limit(500)
  const bleLiveIds = Array.from(
    new Set(
      ((bleRows ?? []) as { membership_id: string }[])
        .map((r) => r.membership_id)
        .filter((v): v is string => !!v),
    ),
  )

  // ROUND-STAFF-2: manager + mine_only 인 경우만 hostess rows 를 자기 담당으로 축소.
  //   owner / super_admin / store_shared / manager rows(자기 자신) 는 통과.
  //   store_uuid 는 위에서 이미 auth.store_uuid 로 제한되어 있으므로 매장 누출 불가.
  let scoped = enriched
  if (
    auth.role === "manager" &&
    !auth.is_super_admin &&
    visibilityMode === "mine_only"
  ) {
    const hostessMembershipIds = enriched
      .filter((a) => a.role === "hostess")
      .map((a) => a.membership_id)
    const managedSet = new Set<string>()
    if (hostessMembershipIds.length > 0) {
      const { data: hsts } = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id")
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .in("membership_id", hostessMembershipIds)
      for (const h of (hsts ?? []) as {
        membership_id: string
        manager_membership_id: string | null
      }[]) {
        if (h.manager_membership_id === auth.membership_id) {
          managedSet.add(h.membership_id)
        }
      }
    }
    scoped = enriched.filter((a) => {
      if (a.role !== "hostess") return true
      return managedSet.has(a.membership_id)
    })
  }

  return {
    store_uuid: auth.store_uuid,
    business_day_id: businessDayId,
    attendance: scoped,
    ble_live_ids: bleLiveIds,
  }
}
