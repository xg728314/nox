import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"

/**
 * POST /api/sessions/pre-settlement — 선정산 등록
 * GET  /api/sessions/pre-settlement?session_id=xxx — 세션별 선정산 내역
 *
 * 요청자(requester) + 실행자(executor) 모두 기록.
 * 실행자 = 현재 로그인 사용자 (counter에서 직접 처리하는 사람).
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      amount?: number
      requester_membership_id?: string
      memo?: string
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, amount, requester_membership_id, memo } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required." },
        { status: 400 }
      )
    }
    if (!amount || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "amount must be a positive number." },
        { status: 400 }
      )
    }
    if (!requester_membership_id || !isValidUUID(requester_membership_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "requester_membership_id is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. 세션 확인 + store_uuid 스코프
    const { data: session } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, business_day_id, status")
      .eq("id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (!session) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found." },
        { status: 404 }
      )
    }

    if (session.status !== "active") {
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: "세션이 활성 상태가 아닙니다. 선정산은 진행 중 세션에서만 가능합니다." },
        { status: 400 }
      )
    }

    // Business day closure guard — block pre-settlement after close.
    {
      const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
      if (guard) return guard
    }

    // 2. 요청자 멤버십 확인
    const { data: requester } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("id", requester_membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "approved")
      .maybeSingle()

    if (!requester) {
      return NextResponse.json(
        { error: "REQUESTER_NOT_FOUND", message: "요청자를 찾을 수 없습니다." },
        { status: 404 }
      )
    }

    // 3. INSERT
    const { data: preSettlement, error: insertError } = await supabase
      .from("pre_settlements")
      .insert({
        store_uuid: authContext.store_uuid,
        session_id,
        business_day_id: session.business_day_id,
        amount,
        memo: memo?.trim() || null,
        requester_membership_id,
        executor_membership_id: authContext.membership_id,
        status: "active",
      })
      .select("id, session_id, amount, memo, requester_membership_id, executor_membership_id, status, created_at")
      .single()

    if (insertError || !preSettlement) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "선정산 등록에 실패했습니다." },
        { status: 500 }
      )
    }

    // 4. Audit — 요청자 + 실행자 모두 기록
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "pre_settlements",
      entity_id: preSettlement.id,
      action: "pre_settlement_created",
      after: {
        amount,
        requester_membership_id,
        executor_membership_id: authContext.membership_id,
        memo: memo?.trim() || null,
      },
    })

    return NextResponse.json(preSettlement, { status: 201 })
  } catch (error) {
    return handleRouteError(error, "pre-settlement")
  }
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id")

    if (!sessionId || !isValidUUID(sessionId)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: preSettlements } = await supabase
      .from("pre_settlements")
      .select("id, session_id, amount, memo, requester_membership_id, executor_membership_id, status, deducted_at, created_at")
      .eq("session_id", sessionId)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    // 이름 조회
    const membershipIds = new Set<string>()
    for (const ps of preSettlements ?? []) {
      membershipIds.add(ps.requester_membership_id)
      membershipIds.add(ps.executor_membership_id)
    }

    const nameMap = new Map<string, string>()
    if (membershipIds.size > 0) {
      const ids = [...membershipIds]
      const { data: mgrNames } = await supabase
        .from("managers")
        .select("membership_id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("membership_id", ids)
      for (const m of mgrNames ?? []) nameMap.set(m.membership_id, m.name)

      const { data: hstNames } = await supabase
        .from("hostesses")
        .select("membership_id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("membership_id", ids)
      for (const h of hstNames ?? []) {
        if (!nameMap.has(h.membership_id)) nameMap.set(h.membership_id, h.name)
      }
    }

    const totalActive = (preSettlements ?? [])
      .filter((ps: { status: string }) => ps.status === "active")
      .reduce((sum: number, ps: { amount: number }) => sum + ps.amount, 0)

    const enriched = (preSettlements ?? []).map((ps: {
      id: string; session_id: string; amount: number; memo: string | null;
      requester_membership_id: string; executor_membership_id: string;
      status: string; deducted_at: string | null; created_at: string
    }) => ({
      ...ps,
      requester_name: nameMap.get(ps.requester_membership_id) || null,
      executor_name: nameMap.get(ps.executor_membership_id) || null,
    }))

    return NextResponse.json({
      session_id: sessionId,
      pre_settlements: enriched,
      total_active: totalActive,
    })
  } catch (error) {
    return handleRouteError(error, "pre-settlement")
  }
}
