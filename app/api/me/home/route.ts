import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: hostess /me/home 페이지 polling.
//   active_session, today_count, chat_unread 모두 조용히 변동 — 5초 캐시 + SWR.
const HOME_TTL_MS = 5000

/**
 * GET /api/me/home
 *
 * R-Hostess-Home (2026-05-01): hostess (스태프) 전용 dashboard 데이터.
 *
 * 운영자 의도:
 *   "스태프는 내가 들어간 방 외에는 보이면 안 되고
 *    내가 들어간 방에 채팅창 / 친구찾아 DM / 내가 일한 갯수 만 나와야 한다."
 *
 * 정책:
 *   - role 무관: hostess / staff / waiter 까지 본인 시점 정보만 반환.
 *     manager / owner 가 호출해도 본인 정보 응답 (scope = membership_id).
 *   - 다른 직원 정보 X (DM 후보로만 staff_pool 에 일부 노출).
 *
 * 응답:
 *   active_session: {
 *     session_id, room_uuid, room_no, room_name,
 *     category, entered_at, time_minutes, manager_name
 *   } | null
 *   today_count:  오늘 영업일 본인 참여 갯수
 *   month_count:  이번 달 (calendar month) 본인 참여 갯수
 *   chat_unread:  본인 미읽음 채팅 합계
 *   staff_pool:   매장 직원 목록 (DM 후보, 본인 제외)
 *
 * 성능: 4개 query Promise.all 병렬.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

type ActiveSessionOut = {
  session_id: string
  room_uuid: string
  room_no: string | null
  room_name: string | null
  category: string | null
  entered_at: string
  time_minutes: number
  manager_name: string | null
}

type StaffPoolEntry = {
  membership_id: string
  name: string
  role: string
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = supa()
    const storeUuid = auth.store_uuid
    const membershipId = auth.membership_id

    // 영업일 KST 기준 — counter 도 같은 helper 사용 (정합성).
    const businessDate = getBusinessDateForOps()
    // 이번 달 calendar 첫날 (정산 / 월 통계 표준).
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

    type HomePayload = {
      active_session: ActiveSessionOut | null
      today_count: number
      month_count: number
      chat_unread: number
      staff_pool: StaffPoolEntry[]
      generated_at: string
    }

    const cacheKey = `${storeUuid}:${membershipId}`
    const payload = await cached<HomePayload>(
      "me_home",
      cacheKey,
      HOME_TTL_MS,
      async () => buildHomePayload(supabase, storeUuid, membershipId, businessDate, monthStart),
    )

    const res = NextResponse.json(payload)
    res.headers.set(
      "Cache-Control",
      "private, max-age=3, stale-while-revalidate=15",
    )
    return res
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// 본문 함수로 추출 — cached() 호환.
// Supabase 제네릭 호환 회피용 unknown 캐스팅 (타입 시스템 한정).
async function buildHomePayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeUuid: string,
  membershipId: string,
  businessDate: string,
  monthStart: string,
): Promise<{
  active_session: ActiveSessionOut | null
  today_count: number
  month_count: number
  chat_unread: number
  staff_pool: StaffPoolEntry[]
  generated_at: string
}> {
    const [activeRes, todayRes, monthRes, chatRes, staffRes] = await Promise.all([
      // 1. Active participation (room_sessions 가 active 인 row 만)
      supabase
        .from("session_participants")
        .select(
          "id, session_id, status, category, entered_at, time_minutes, room_sessions!inner(id, room_uuid, status, started_at, manager_name, store_uuid)",
        )
        .eq("store_uuid", storeUuid)
        .eq("membership_id", membershipId)
        .eq("status", "active")
        .order("entered_at", { ascending: false })
        .limit(1),
      // 2. 오늘 영업일 참여 갯수 (business_day_id 기준)
      supabase
        .from("session_participants")
        .select("id, room_sessions!inner(business_day_id, store_operating_days!inner(business_date))", { count: "exact", head: true })
        .eq("store_uuid", storeUuid)
        .eq("membership_id", membershipId)
        .eq("room_sessions.store_operating_days.business_date", businessDate),
      // 3. 이번 달 참여 갯수 (entered_at 기준 — 월 통계는 calendar 기준)
      supabase
        .from("session_participants")
        .select("id", { count: "exact", head: true })
        .eq("store_uuid", storeUuid)
        .eq("membership_id", membershipId)
        .gte("entered_at", `${monthStart}T00:00:00+09:00`),
      // 4. Chat unread
      supabase
        .from("chat_participants")
        .select("unread_count")
        .eq("store_uuid", storeUuid)
        .eq("membership_id", membershipId),
      // 5. Staff pool (DM 후보, 본인 제외)
      supabase
        .from("store_memberships")
        .select(
          "id, role, profile_id, profiles!inner(id, name)",
        )
        .eq("store_uuid", storeUuid)
        .eq("status", "approved")
        .is("deleted_at", null)
        .neq("id", membershipId),
    ])

    // ── active_session 조립 ──
    let activeSession: ActiveSessionOut | null = null
    type ActiveRow = {
      id: string
      session_id: string
      status: string
      category: string | null
      entered_at: string
      time_minutes: number
      room_sessions: {
        id: string
        room_uuid: string
        status: string
        started_at: string
        manager_name: string | null
        store_uuid: string
      } | null
    }
    const activeRows = (activeRes.data ?? []) as unknown as ActiveRow[]
    const activeRow = activeRows.find((r) => r.room_sessions?.status === "active") ?? null
    if (activeRow && activeRow.room_sessions) {
      // 방 정보 — 별도 조회 (room_uuid 로)
      const { data: roomRow } = await supabase
        .from("rooms")
        .select("room_no, room_name")
        .eq("id", activeRow.room_sessions.room_uuid)
        .maybeSingle()
      activeSession = {
        session_id: activeRow.session_id,
        room_uuid: activeRow.room_sessions.room_uuid,
        room_no: (roomRow?.room_no as string | null) ?? null,
        room_name: (roomRow?.room_name as string | null) ?? null,
        category: activeRow.category,
        entered_at: activeRow.entered_at,
        time_minutes: activeRow.time_minutes,
        manager_name: activeRow.room_sessions.manager_name,
      }
    }

    // ── chat_unread sum ──
    type ChatRow = { unread_count: number | null }
    const chatRows = (chatRes.data ?? []) as ChatRow[]
    const chatUnread = chatRows.reduce((s, r) => s + (r.unread_count ?? 0), 0)

    // ── staff_pool 변환 ──
    type StaffRow = {
      id: string
      role: string
      profile_id: string
      profiles: { id: string; name: string | null } | null
    }
    const staffRows = (staffRes.data ?? []) as unknown as StaffRow[]
    const staffPool: StaffPoolEntry[] = staffRows
      .filter((r) => r.profiles?.name)
      .map((r) => ({
        membership_id: r.id,
        name: r.profiles!.name as string,
        role: r.role,
      }))

    return {
      active_session: activeSession,
      today_count: todayRes.count ?? 0,
      month_count: monthRes.count ?? 0,
      chat_unread: chatUnread,
      staff_pool: staffPool,
      generated_at: new Date().toISOString(),
    }
}
