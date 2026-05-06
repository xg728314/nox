import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/me/settlements
 * 스태프 본인의 정산 내역 조회 (읽기 전용).
 * 본인 지급액만 노출 — 실장수익(manager_payout_amount) 비노출.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 내가 참여한 세션별 상세
    const { data: participants } = await supabase
      .from("session_participants")
      .select("id, session_id, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", authContext.membership_id)
      .eq("role", "hostess")
      .is("deleted_at", null)
      .order("entered_at", { ascending: false })

    if (!participants || participants.length === 0) {
      return NextResponse.json({ settlements: [], daily_summary: [] })
    }

    // 2026-05-06: 5 RTT (Phase 1 sessions → Phase 2 rooms+bizDays+receipts) →
    //   2 wave: Phase 1 sessions + receipts (sessionIds 의존), Phase 2 rooms +
    //   bizDays (sessions 결과 의존).
    const sessionIds = [...new Set(participants.map((p: { session_id: string }) => p.session_id))]

    const [sessionsRes, receiptsRes] = await Promise.all([
      supabase
        .from("room_sessions")
        .select("id, room_uuid, business_day_id, status")
        .eq("store_uuid", authContext.store_uuid)
        .in("id", sessionIds),
      supabase
        .from("receipts")
        .select("session_id, status")
        .eq("store_uuid", authContext.store_uuid)
        .in("session_id", sessionIds)
        .order("version", { ascending: false }),
    ])

    const sessions = sessionsRes.data
    const receipts = receiptsRes.data

    const sessionMap = new Map<string, { room_uuid: string; business_day_id: string | null; status: string }>()
    for (const s of sessions ?? []) {
      sessionMap.set(s.id, { room_uuid: s.room_uuid, business_day_id: s.business_day_id, status: s.status })
    }

    // 3-4. rooms + bizDays 동시 fetch (Phase 2).
    const roomUuids = [...new Set((sessions ?? []).map((s: { room_uuid: string }) => s.room_uuid))]
    const bizDayIds = [...new Set(
      (sessions ?? [])
        .map((s: { business_day_id: string | null }) => s.business_day_id)
        .filter((id): id is string => id !== null)
    )]

    const [roomsRes, bizDaysRes] = await Promise.all([
      roomUuids.length > 0
        ? supabase
            .from("rooms")
            .select("id, name")
            .eq("store_uuid", authContext.store_uuid)
            .in("id", roomUuids)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      bizDayIds.length > 0
        ? supabase
            .from("store_operating_days")
            .select("id, business_date")
            .in("id", bizDayIds)
            .eq("store_uuid", authContext.store_uuid)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Array<{ id: string; business_date: string }> }),
    ])

    const roomNameMap = new Map<string, string>()
    for (const r of roomsRes.data ?? []) roomNameMap.set(r.id, r.name)

    const bizDayMap = new Map<string, string>()
    for (const b of bizDaysRes.data ?? []) bizDayMap.set(b.id, b.business_date)

    const receiptStatusMap = new Map<string, string>()
    for (const r of receipts ?? []) {
      if (!receiptStatusMap.has(r.session_id)) {
        receiptStatusMap.set(r.session_id, r.status)
      }
    }

    // 6. 응답 조합 — 실장수익(manager_payout_amount) 비노출
    const settlements = participants.map((p: {
      id: string; session_id: string; category: string; time_minutes: number;
      price_amount: number; hostess_payout_amount: number; status: string; entered_at: string
    }) => {
      const sess = sessionMap.get(p.session_id)
      const businessDate = sess?.business_day_id ? bizDayMap.get(sess.business_day_id) || null : null

      return {
        participant_id: p.id,
        session_id: p.session_id,
        category: p.category,
        time_minutes: p.time_minutes,
        hostess_payout: p.hostess_payout_amount,
        status: p.status,
        entered_at: p.entered_at,
        room_name: sess ? roomNameMap.get(sess.room_uuid) || null : null,
        business_date: businessDate,
        session_status: sess?.status || null,
        receipt_status: receiptStatusMap.get(p.session_id) || null,
      }
    })

    // 7. 일별 합계
    const dailyMap = new Map<string, { date: string; total_payout: number; count: number; finalized: number }>()
    for (const s of settlements) {
      const date = s.business_date || "미지정"
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { date, total_payout: 0, count: 0, finalized: 0 })
      }
      const entry = dailyMap.get(date)!
      entry.total_payout += s.hostess_payout
      entry.count++
      if (s.receipt_status === "finalized") entry.finalized++
    }

    const daily_summary = [...dailyMap.values()].sort((a, b) => b.date.localeCompare(a.date))

    return NextResponse.json({ settlements, daily_summary })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
