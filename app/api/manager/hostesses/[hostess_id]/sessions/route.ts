import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/manager/hostesses/[hostess_id]/sessions?business_day_id=xxx
 * 특정 스태프의 당일 세션별 참여 내역을 반환한다.
 * hostess_id = membership_id
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_id must be a valid UUID." },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const businessDayId = searchParams.get("business_day_id")
    if (!businessDayId || !isValidUUID(businessDayId)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 매니저는 자기 담당 스태프만 조회 가능
    if (authContext.role === "manager") {
      const { data: assignment } = await supabase
        .from("hostesses")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("manager_membership_id", authContext.membership_id)
        .eq("membership_id", hostess_id)
        .maybeSingle()

      if (!assignment) {
        return NextResponse.json(
          { error: "NOT_ASSIGNED", message: "이 스태프는 담당이 아닙니다." },
          { status: 403 }
        )
      }
    }

    // 1. 해당 영업일의 세션 목록
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ participants: [] })
    }

    const sessionIds = sessions.map((s: { id: string }) => s.id)

    // 2. 이 스태프의 참여 내역
    const { data: participations } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", hostess_id)
      .in("session_id", sessionIds)
      .is("deleted_at", null)

    if (!participations || participations.length === 0) {
      return NextResponse.json({ participants: [] })
    }

    // 3. 방 이름 조회
    const roomUuids = [...new Set(sessions.map((s: { room_uuid: string }) => s.room_uuid))]
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("store_uuid", authContext.store_uuid)
      .in("id", roomUuids)

    const roomNameMap = new Map<string, string>()
    for (const r of rooms ?? []) {
      roomNameMap.set(r.id, r.name)
    }

    // 4. 영수증 상태 조회
    const participantSessionIds = [...new Set(participations.map((p: { session_id: string }) => p.session_id))]
    const { data: receipts } = await supabase
      .from("receipts")
      .select("session_id, status")
      .eq("store_uuid", authContext.store_uuid)
      .in("session_id", participantSessionIds)
      .order("version", { ascending: false })

    const receiptStatusMap = new Map<string, string>()
    for (const r of receipts ?? []) {
      // 첫 번째(최신 버전)만 사용
      if (!receiptStatusMap.has(r.session_id)) {
        receiptStatusMap.set(r.session_id, r.status)
      }
    }

    // 5. 세션 정보 맵
    const sessionMap = new Map<string, { room_uuid: string; status: string }>()
    for (const s of sessions) {
      sessionMap.set(s.id, { room_uuid: s.room_uuid, status: s.status })
    }

    // 6. 스태프 이름 조회
    const { data: hostessInfo } = await supabase
      .from("hostesses")
      .select("name")
      .eq("store_uuid", authContext.store_uuid)
      .eq("membership_id", hostess_id)
      .maybeSingle()

    const hostessName = hostessInfo?.name || ""

    // 7. 응답 조합
    // R28-fix: CLAUDE.md 의 잠긴 규칙 — "사장이 볼 수 없음: 실장 개별 수익,
    //   아가씨 개별 수익. owner 정산 UI 에서 manager_payout_amount,
    //   hostess_payout_amount 개별 노출 금지". 이전엔 owner 호출 시도 그대로
    //   응답해 비즈니스 규칙 위반.
    //
    //   권한 매트릭스:
    //     manager (본인 담당 스태프 조회) → 자기 수익이라 노출 OK
    //     owner                          → 개별 금액 마스킹 (null)
    //     hostess                        → 위에서 차단됨 (line 18)
    const isOwnerView = authContext.role === "owner"

    const result = participations.map((p: {
      id: string; session_id: string; membership_id: string; role: string;
      category: string; time_minutes: number; price_amount: number;
      manager_payout_amount: number; hostess_payout_amount: number; status: string
    }) => {
      const sess = sessionMap.get(p.session_id)
      return {
        id: p.id,
        session_id: p.session_id,
        membership_id: p.membership_id,
        role: p.role,
        category: p.category,
        time_minutes: p.time_minutes,
        price_amount: p.price_amount,
        manager_payout_amount: isOwnerView ? null : p.manager_payout_amount,
        hostess_payout_amount: isOwnerView ? null : p.hostess_payout_amount,
        status: p.status,
        room_name: sess ? roomNameMap.get(sess.room_uuid) || null : null,
        session_status: sess?.status || "unknown",
        receipt_status: receiptStatusMap.get(p.session_id) || null,
      }
    })

    return NextResponse.json({ hostess_name: hostessName, participants: result })
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
      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
