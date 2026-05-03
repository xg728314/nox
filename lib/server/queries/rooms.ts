import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export type SessionInfo = {
  id: string
  status: string
  started_at: string
  ended_at?: string | null
  participant_count: number
  gross_total: number
  participant_total: number
  order_total: number
  manager_name: string | null
  customer_name_snapshot: string | null
  customer_party_size: number
}

export type RoomWithSession = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session: SessionInfo | null
  closed_session: SessionInfo | null
}

export type DailyTotals = {
  total_sessions: number
  gross_total: number
  order_total: number
  participant_total: number
}

export type RoomsResponse = {
  store_uuid: string
  business_day_id: string | null
  rooms: RoomWithSession[]
  /**
   * 2026-05-01 R-Counter-Speed: 카운터 화면이 /api/rooms 직후 /api/reports/daily
   *   를 직렬 fetch (599ms + 229ms) 하던 패턴을 단일 응답에 합침. business_day_id
   *   가 있을 때만 채워서 반환. 클라이언트는 이 필드가 있으면 daily fetch 생략.
   */
  daily_totals?: DailyTotals | null
}

export async function getRooms(auth: AuthContext): Promise<RoomsResponse> {
  const supabase = getServiceClient()

  type SessionRow = {
    id: string; room_uuid: string; status: string; started_at: string;
    ended_at?: string | null;
    manager_name: string | null;
    manager_membership_id?: string | null;
    customer_name_snapshot?: string | null;
    customer_party_size?: number | null;
  }

  // 2026-05-01 R-Counter-Speed: rooms + sessions + bizDay 모두 store_uuid
  //   만 의존 → 3개 동시 fire. 직렬 ~3 round-trip → 1 round-trip.
  // session fallback 체인은 첫 시도가 실패한 경우만 가동.
  // 2026-05-03 R-KST-fix: 기존 `new Date().toISOString().split("T")[0]` 은 UTC.
  //   KST 00:00~08:59 시간대에 카운터 호출 → 전날 business_day 로 lookup →
  //   "오늘 기록 없음" 으로 dailyTotals null. KST 영업일 보정 helper 사용.
  const today = getBusinessDateForOps()
  const [roomsRes, sessionsRes, bizDayRes] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active")
      .eq("store_uuid", auth.store_uuid)
      .order("sort_order", { ascending: true }),
    supabase
      .from("room_sessions")
      .select("id, room_uuid, status, started_at, ended_at, manager_name, customer_name_snapshot, customer_party_size")
      .eq("store_uuid", auth.store_uuid)
      .in("status", ["active", "closed"])
      .is("archived_at", null),
    supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_date", today)
      .maybeSingle(),
  ])

  const { data: rooms, error: roomsError } = roomsRes
  if (roomsError) throw new Error("Failed to query rooms.")

  let allSessions: SessionRow[] | null = null
  // 2026-04-24: archived_at 필터 — migration 085. 미적용 환경 4단 fallback.
  if (!sessionsRes.error && sessionsRes.data) {
    allSessions = sessionsRes.data
  } else {
    const { data: s2, error: e2 } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status, started_at, ended_at, manager_name, customer_name_snapshot, customer_party_size")
      .eq("store_uuid", auth.store_uuid)
      .in("status", ["active", "closed"])
    if (!e2 && s2) {
      allSessions = s2
    } else {
      const { data: s3, error: e3 } = await supabase
        .from("room_sessions")
        .select("id, room_uuid, status, started_at, ended_at, manager_name")
        .eq("store_uuid", auth.store_uuid)
        .in("status", ["active", "closed"])
        .is("archived_at", null)
      if (!e3 && s3) {
        allSessions = s3
      } else {
        const { data: s4 } = await supabase
          .from("room_sessions")
          .select("id, room_uuid, status, started_at, ended_at, manager_name")
          .eq("store_uuid", auth.store_uuid)
          .in("status", ["active", "closed"])
        allSessions = s4
      }
    }
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const activeSessions = (allSessions ?? []).filter(s => s.status === "active")
  const closedSessions = (allSessions ?? []).filter(s =>
    s.status === "closed" && s.ended_at && s.ended_at > sixHoursAgo,
  )

  const sessionMap = new Map<string, SessionInfo>()
  const closedSessionMap = new Map<string, SessionInfo>()

  // 2026-05-01 R-Counter-Speed: 카운터 화면 daily_totals 를 inline 으로 함께
  //   집계. business_day_id 가 있을 때만 receipts query 추가 (Promise.all 병렬).
  //   기존 클라가 /api/rooms 직후 /api/reports/daily 직렬 fetch 하던 것 (599+229ms)
  //   을 단일 응답으로 합쳐 ~250ms 절감.
  const businessDayId = bizDayRes.data?.id ?? null
  let dailyTotals: DailyTotals | null = null

  const allSessionsList = [...activeSessions, ...closedSessions]
  if (allSessionsList.length > 0 || businessDayId) {
    const sessionIds = allSessionsList.map(s => s.id)

    const partsP =
      sessionIds.length > 0
        ? supabase
            .from("session_participants")
            .select("session_id, price_amount")
            .in("session_id", sessionIds)
            .eq("store_uuid", auth.store_uuid)
            .is("deleted_at", null)
            .then((r) => r as { data: Array<{ session_id: string; price_amount: number }> | null })
        : Promise.resolve({ data: [] as Array<{ session_id: string; price_amount: number }> })

    const ordersP =
      sessionIds.length > 0
        ? supabase
            .from("orders")
            .select("session_id, customer_amount")
            .in("session_id", sessionIds)
            .eq("store_uuid", auth.store_uuid)
            .is("deleted_at", null)
            .then((r) => r as { data: Array<{ session_id: string; customer_amount: number }> | null })
        : Promise.resolve({ data: [] as Array<{ session_id: string; customer_amount: number }> })

    const receiptsP = businessDayId
      ? supabase
          .from("receipts")
          .select("gross_total, order_total_amount, participant_total_amount")
          .eq("store_uuid", auth.store_uuid)
          .eq("business_day_id", businessDayId)
          .then((r) => r as { data: Array<{ gross_total: number | null; order_total_amount: number | null; participant_total_amount: number | null }> | null })
      : Promise.resolve({ data: null as Array<{ gross_total: number | null; order_total_amount: number | null; participant_total_amount: number | null }> | null })

    const [partsRes, ordersRes, receiptsRes] = await Promise.all([partsP, ordersP, receiptsP])
    const { data: participants } = partsRes
    const { data: orders } = ordersRes

    if (businessDayId) {
      const receipts = receiptsRes.data ?? []
      let gross = 0, ord = 0, part = 0
      for (const r of receipts) {
        gross += Number(r.gross_total ?? 0) || 0
        ord += Number(r.order_total_amount ?? 0) || 0
        part += Number(r.participant_total_amount ?? 0) || 0
      }
      dailyTotals = {
        total_sessions: receipts.length,
        gross_total: gross,
        order_total: ord,
        participant_total: part,
      }
    }

    const countMap = new Map<string, number>()
    const participantTotalMap = new Map<string, number>()
    if (participants) {
      for (const p of participants) {
        countMap.set(p.session_id, (countMap.get(p.session_id) || 0) + 1)
        participantTotalMap.set(p.session_id, (participantTotalMap.get(p.session_id) || 0) + (p.price_amount || 0))
      }
    }

    const orderTotalMap = new Map<string, number>()
    if (orders) {
      for (const o of orders as { session_id: string; customer_amount: number }[]) {
        orderTotalMap.set(o.session_id, (orderTotalMap.get(o.session_id) || 0) + (o.customer_amount || 0))
      }
    }

    for (const s of activeSessions) {
      const pTotal = participantTotalMap.get(s.id) || 0
      const oTotal = orderTotalMap.get(s.id) || 0
      sessionMap.set(s.room_uuid, {
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at ?? null,
        participant_count: countMap.get(s.id) || 0,
        gross_total: pTotal + oTotal,
        participant_total: pTotal,
        order_total: oTotal,
        manager_name: s.manager_name ?? null,
        customer_name_snapshot: (s as Record<string, unknown>).customer_name_snapshot as string | null ?? null,
        customer_party_size: ((s as Record<string, unknown>).customer_party_size as number) ?? 0,
      })
    }

    for (const s of closedSessions) {
      const pTotal = participantTotalMap.get(s.id) || 0
      const oTotal = orderTotalMap.get(s.id) || 0
      closedSessionMap.set(s.room_uuid, {
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at ?? null,
        participant_count: countMap.get(s.id) || 0,
        gross_total: pTotal + oTotal,
        participant_total: pTotal,
        order_total: oTotal,
        manager_name: s.manager_name ?? null,
        customer_name_snapshot: (s as Record<string, unknown>).customer_name_snapshot as string | null ?? null,
        customer_party_size: ((s as Record<string, unknown>).customer_party_size as number) ?? 0,
      })
    }
  }

  const roomsWithSessions: RoomWithSession[] = (rooms ?? []).map((room: { id: string; room_no: string; room_name: string; is_active: boolean }) => ({
    ...room,
    session: sessionMap.get(room.id) || null,
    closed_session: closedSessionMap.get(room.id) || null,
  }))

  return {
    store_uuid: auth.store_uuid,
    business_day_id: businessDayId,
    rooms: roomsWithSessions,
    daily_totals: dailyTotals,
  }
}
