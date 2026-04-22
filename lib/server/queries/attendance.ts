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
}

export async function getAttendance(auth: AuthContext): Promise<AttendanceResponse> {
  const supabase = getServiceClient()

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
      return { store_uuid: auth.store_uuid, business_day_id: null, attendance: [] }
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

  return { store_uuid: auth.store_uuid, business_day_id: businessDayId, attendance: enriched }
}
