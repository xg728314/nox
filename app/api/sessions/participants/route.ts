import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"
import { lookupServiceType, lookupCategoryPricing } from "@/lib/session/services/pricingLookup"

const VALID_ROLES = ["manager", "hostess"] as const
const VALID_CATEGORIES = ["퍼블릭", "셔츠", "하퍼", "차3"] as const

type ParticipantRole = typeof VALID_ROLES[number]
type ParticipantCategory = typeof VALID_CATEGORIES[number]

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to register participants." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      membership_id?: string
      role?: string
      category?: string
      time_minutes?: number
      time_type?: string
      manager_deduction?: number
      greeting_confirmed?: boolean
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, membership_id, role, category, time_minutes, time_type, manager_deduction, greeting_confirmed } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id is required and must be a valid UUID." }, { status: 400 })
    }
    // 미지정 placeholder: null / undefined / all-zeros UUID
    const PLACEHOLDER_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000000"
    const isPlaceholder =
      membership_id === null ||
      membership_id === undefined ||
      membership_id === PLACEHOLDER_MEMBERSHIP_ID

    if (!isPlaceholder && !isValidUUID(membership_id!)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }
    if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "role must be one of: manager, hostess." }, { status: 400 })
    }
    // placeholder는 category 미지정 허용 (종목은 나중에 PATCH로 확정)
    if (!isPlaceholder && (!category || !(VALID_CATEGORIES as readonly string[]).includes(category))) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "category must be one of: 퍼블릭, 셔츠, 하퍼." }, { status: 400 })
    }
    if (time_minutes === undefined || time_minutes === null || typeof time_minutes !== "number") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "time_minutes is required and must be a number." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status, business_day_id")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND", message: "Session not found." }, { status: 404 })
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "SESSION_NOT_ACTIVE", message: "Session is not active." }, { status: 400 })
    }
    if (session.store_uuid !== authContext.store_uuid) {
      return NextResponse.json({ error: "STORE_MISMATCH", message: "Session does not belong to your store." }, { status: 403 })
    }
    // Business day closure guard
    {
      const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
      if (guard) return guard
    }

    let originStoreUuid: string | null = null
    let transferRequestId: string | null = null

    if (!isPlaceholder) {
    const { data: membership, error: membershipError } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, status")
      .eq("id", membership_id)
      .eq("status", "approved")
      .maybeSingle()

    if (membershipError || !membership) {
      return NextResponse.json({ error: "MEMBERSHIP_NOT_FOUND", message: "Membership not found." }, { status: 404 })
    }

    if (membership.store_uuid !== authContext.store_uuid) {
      const { data: cswr } = await supabase
        .from("cross_store_work_records")
        .select("id, origin_store_uuid")
        .eq("session_id", session_id)
        .eq("hostess_membership_id", membership_id)
        .eq("working_store_uuid", authContext.store_uuid)
        .in("status", ["pending", "approved"])
        .is("deleted_at", null)
        .maybeSingle()

      if (!cswr) {
        return NextResponse.json({ error: "CROSS_STORE_NOT_FOUND", message: "타점 출근 기록이 없습니다." }, { status: 404 })
      }
      originStoreUuid = cswr.origin_store_uuid

      const { data: transferReq } = await supabase
        .from("transfer_requests")
        .select("id")
        .eq("hostess_membership_id", membership_id)
        .eq("to_store_uuid", authContext.store_uuid)
        .eq("from_store_uuid", cswr.origin_store_uuid)
        .in("status", ["pending", "approved", "fully_approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (transferReq) {
        transferRequestId = transferReq.id
      } else {
        const { data: newTr, error: trErr } = await supabase
          .from("transfer_requests")
          .insert({
            hostess_membership_id: membership_id,
            from_store_uuid: cswr.origin_store_uuid,
            to_store_uuid: authContext.store_uuid,
            status: "approved",
            reason: "cross-store work record auto-transfer",
          })
          .select("id")
          .single()

        if (trErr || !newTr) {
          return NextResponse.json({ error: "TRANSFER_CREATE_FAILED", message: trErr?.message || "auto transfer_request failed" }, { status: 500 })
        }
        transferRequestId = newTr.id
      }
    }
    } // end !isPlaceholder

    // ── Time type resolution ──
    let resolvedTimeType = time_type || ""
    if (!resolvedTimeType) {
      if (time_minutes <= 8) {
        resolvedTimeType = "무료"
      } else if (time_minutes <= 15) {
        resolvedTimeType = "차3"
      } else {
        const halfTime = category === "퍼블릭" ? 45 : 30
        const boundaryEnd = halfTime + 10
        if (time_minutes <= halfTime) {
          resolvedTimeType = "반티"
        } else if (time_minutes <= boundaryEnd) {
          return NextResponse.json(
            { error: "BOUNDARY_TIME", message: `경계시간(${halfTime}~${boundaryEnd}분)입니다. time_type을 '반티' 또는 '기본'으로 지정해주세요.` },
            { status: 400 }
          )
        } else {
          resolvedTimeType = "기본"
        }
      }
    }

    // ── Pricing lookup (shared helper) ──
    let price_amount = 0
    let resolvedManagerDeduction = manager_deduction ?? 0

    if (resolvedTimeType !== "무료") {
      const serviceType = await lookupServiceType(supabase, authContext.store_uuid, category as string, resolvedTimeType)
      if (!serviceType) {
        return NextResponse.json(
          { error: "SERVICE_TYPE_NOT_FOUND", message: `가격을 찾을 수 없습니다: ${category}/${resolvedTimeType}` },
          { status: 404 }
        )
      }
      if (serviceType.has_greeting_check && !greeting_confirmed) {
        return NextResponse.json(
          { error: "GREETING_REQUIRED", message: "인사확인이 필요합니다. greeting_confirmed=true를 전달해주세요." },
          { status: 400 }
        )
      }
      price_amount = serviceType.price
      if (manager_deduction === undefined || manager_deduction === null) {
        resolvedManagerDeduction = serviceType.manager_deduction
      }
    }

    // cha3/banti amounts (shared helper)
    let cha3_amount = 0
    let banti_amount = 0

    if (resolvedTimeType !== "무료") {
      const pricing = await lookupCategoryPricing(supabase, authContext.store_uuid, category as string, resolvedTimeType)
      cha3_amount = pricing.cha3Amount
      banti_amount = pricing.bantiAmount
    }

    const hostess_payout = Math.max(0, price_amount - resolvedManagerDeduction)

    const { data: participant, error: participantError } = await supabase
      .from("session_participants")
      .insert({
        session_id,
        membership_id: isPlaceholder ? null : membership_id,
        memo: isPlaceholder ? "미지정" : null,
        role: role as ParticipantRole,
        category: (isPlaceholder && !category) ? null : category as ParticipantCategory,
        time_minutes,
        price_amount,
        manager_payout_amount: resolvedManagerDeduction,
        hostess_payout_amount: hostess_payout,
        margin_amount: 0,
        cha3_amount,
        banti_amount,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: greeting_confirmed ?? false,
        origin_store_uuid: originStoreUuid,
        transfer_request_id: transferRequestId,
        status: "active",
        store_uuid: authContext.store_uuid,
      })
      .select("id, session_id, membership_id, role, category, time_minutes, price_amount, cha3_amount, banti_amount, waiter_tip_received, waiter_tip_amount, manager_payout_amount, hostess_payout_amount, greeting_confirmed, status, entered_at")
      .single()

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "PARTICIPANT_CREATE_FAILED", message: participantError?.message || "Failed to register participant.", db_code: participantError?.code },
        { status: 500 }
      )
    }

    // 2026-05-01 R-Counter-Speed: audit + cache invalidate background fire.
    //   await 하면 응답 latency +100~200ms. 사용자 호소 "스태프 추가 느림" 직접 원인.
    //   audit 는 best-effort (실패는 console.warn 로그 남기되 응답 차단 X).
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "session_participants",
      entity_id: participant.id,
      action: "participant_registered",
      after: { membership_id, role, category, time_type: resolvedTimeType, time_minutes, price_amount, cha3_amount, banti_amount, status: "active" },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[participants] audit write failed:", e instanceof Error ? e.message : e)
    })
    invalidateCache("monitor")

    return NextResponse.json(
      {
        participant_id: participant.id,
        session_id: participant.session_id,
        membership_id: participant.membership_id,
        role: participant.role,
        category: participant.category,
        time_type: resolvedTimeType,
        time_minutes: participant.time_minutes,
        price_amount: participant.price_amount,
        cha3_amount: participant.cha3_amount,
        banti_amount: participant.banti_amount,
        waiter_tip_received: participant.waiter_tip_received,
        waiter_tip_amount: participant.waiter_tip_amount,
        manager_deduction: participant.manager_payout_amount,
        hostess_payout: participant.hostess_payout_amount,
        status: participant.status,
        entered_at: participant.entered_at,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "participants")
  }
}
