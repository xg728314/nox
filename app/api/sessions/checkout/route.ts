import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

/**
 * STEP-4C: Cutover to close_session_atomic RPC.
 *
 * All precondition validation (session active, business day open, resolved
 * participants, valid order pricing) AND all state writes (participants
 * active→left, session close, best-effort chat close) now live inside a
 * single DB transaction. The app route is responsible for auth / role
 * gate / UUID validation / audit after success.
 *
 * Prior STEP-003 app-layer optimistic-lock guards have been superseded by
 * the RPC's FOR UPDATE + status filter — there is no fallback write path.
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to checkout sessions." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{ session_id?: string }>(request)
    if (parsed.error) return parsed.error
    const { session_id } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required and must be a valid UUID." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-01 R-No-Manager-OK: 실장 미지정 세션 체크아웃 허용.
    //   운영자 정책: "실장 지정이 안됐으면 가게 매출로 잡자."
    //   기존: MANAGER_REQUIRED 로 차단 (체크아웃 불가).
    //   변경: 차단 제거. 정산 계산 (calculateSettlementTotals) 이 자동으로
    //     manager_payout_amount=0 처리 → 실장 수익 0 → 그만큼 가게 매출 ↑.
    //     비즈니스 룰: "실장 수익 = 종목 단가 - 호스티스 수익" 의 default 0.
    //   외상 등록은 별도로 manager_membership_id 필요 (CreditRegisterModal
    //   가드 그대로 유지) — 체크아웃 자체는 허용.

    // ── STEP-4C: atomic close via DB RPC ────────────────────────────────
    const { data: rpcData, error: rpcError } = await supabase.rpc("close_session_atomic", {
      p_session_id: session_id,
      p_store_uuid: authContext.store_uuid,
      p_closed_by: authContext.user_id,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ""

      if (msg.startsWith("SESSION_NOT_FOUND")) {
        return NextResponse.json(
          { error: "SESSION_NOT_FOUND", message: "Session not found in this store." },
          { status: 404 }
        )
      }
      if (msg.startsWith("SESSION_NOT_ACTIVE")) {
        return NextResponse.json(
          { error: "SESSION_NOT_ACTIVE", message: "세션이 활성 상태가 아닙니다." },
          { status: 409 }
        )
      }
      if (msg.startsWith("BUSINESS_DAY_CLOSED")) {
        return NextResponse.json(
          { error: "BUSINESS_DAY_CLOSED", message: "영업일이 마감되었습니다." },
          { status: 403 }
        )
      }
      if (msg.startsWith("UNRESOLVED_PARTICIPANTS")) {
        // RPC formats the array as `{uuid1,uuid2,...}` via default text cast.
        const idsMatch = msg.match(/\{([^}]*)\}/)
        const ids = idsMatch
          ? idsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
          : []
        return NextResponse.json(
          {
            success: false,
            code: "UNRESOLVED_PARTICIPANTS",
            message: `미확정 스태프가 ${ids.length}명 있습니다. 종목을 확정한 후 체크아웃하세요.`,
            unresolved_ids: ids,
          },
          { status: 400 }
        )
      }
      if (msg.startsWith("INVALID_ORDER_PRICES")) {
        const idsMatch = msg.match(/\{([^}]*)\}/)
        const ids = idsMatch
          ? idsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
          : []
        return NextResponse.json(
          {
            error: "INVALID_ORDER_PRICES",
            message: `가격 미설정 주문이 ${ids.length}건 있습니다.`,
            invalid_ids: ids,
          },
          { status: 400 }
        )
      }
      if (msg.startsWith("PRICE_VALIDATION_FAILED")) {
        const idsMatch = msg.match(/\{([^}]*)\}/)
        const ids = idsMatch
          ? idsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
          : []
        return NextResponse.json(
          {
            error: "PRICE_VALIDATION_FAILED",
            message: `판매가 < 입금가인 주문이 ${ids.length}건 있습니다.`,
            invalid_ids: ids,
          },
          { status: 400 }
        )
      }
      if (msg.startsWith("SESSION_CLOSE_RACE")) {
        return NextResponse.json(
          { error: "SESSION_STATE_CHANGED", message: "세션 상태가 변경되었습니다. 다시 시도해 주세요." },
          { status: 409 }
        )
      }
      // Defensive: any other RAISE (e.g. trigger-emitted ILLEGAL_* codes)
      return NextResponse.json(
        { error: "CHECKOUT_FAILED", message: "Failed to close session." },
        { status: 500 }
      )
    }

    const result = rpcData as {
      session_id: string
      status: string
      ended_at: string
      participants_closed_count: number
      chat_closed: boolean
    }

    // ── Audit (app-layer post-success) ──────────────────────────────────
    // 2026-05-03 R-Speed-x10: 3개 audit await → background fire.
    //   기존: 직렬 3 RTT (~450ms). 현재: 즉시 응답, audit 백그라운드.
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "room_sessions",
      entity_id: session_id,
      action: "session_checkout",
      before: { status: "active" },
      after: {
        status: "closed",
        ended_at: result.ended_at,
        closed_by: authContext.user_id,
      },
    }).catch((e) => {
      console.warn("[checkout] session audit failed:", e instanceof Error ? e.message : e)
    })

    if (result.participants_closed_count > 0) {
      void writeSessionAudit(supabase, {
        auth: authContext,
        session_id,
        entity_table: "session_participants",
        entity_id: session_id,
        action: "participants_checkout",
        before: { status: "active" },
        after: {
          status: "left",
          left_at: result.ended_at,
          participants_closed_count: result.participants_closed_count,
        },
      }).catch((e) => {
        console.warn("[checkout] participants audit failed:", e instanceof Error ? e.message : e)
      })
    }

    if (result.chat_closed) {
      // NOTE: post-cutover audit entity_id is the session_id rather than the
      // chat_room.id returned by the previous app-layer SELECT. chat_rooms
      // row 는 type='room_session' 인 경우 1:1 이라 session_id 로 식별 가능.
      void writeSessionAudit(supabase, {
        auth: authContext,
        session_id,
        entity_table: "chat_rooms",
        entity_id: session_id,
        action: "chat_room_closed",
        before: { is_active: true },
        after: {
          is_active: false,
          closed_at: result.ended_at,
          closed_reason: "checkout",
        },
      }).catch((e) => {
        console.warn("[checkout] chat audit failed:", e instanceof Error ? e.message : e)
      })
    }

    // R29-perf: monitor/rooms 캐시 무효화
    invalidateCache("rooms")
    invalidateCache("monitor")

    return NextResponse.json(
      {
        session_id: result.session_id,
        status: result.status,
        ended_at: result.ended_at,
        participants_closed_count: result.participants_closed_count,
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, "checkout")
  }
}
