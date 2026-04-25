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

    // 2026-04-25 보안: 서버 레벨에서 실장 지정 여부 + 참여자 종목 확인.
    //   UI 는 이미 차단하지만 API 직접 호출 (스크립트 / 악의적 요청) 에
    //   대비해 서버에서도 명시적 차단.
    const { data: sessionCheck } = await supabase
      .from("room_sessions")
      .select("id, manager_name, manager_membership_id, is_external_manager")
      .eq("id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()
    if (sessionCheck) {
      const hasManager = !!(
        sessionCheck.manager_name ||
        sessionCheck.manager_membership_id ||
        sessionCheck.is_external_manager
      )
      if (!hasManager) {
        return NextResponse.json(
          {
            error: "MANAGER_REQUIRED",
            message: "실장이 지정되지 않은 세션은 체크아웃할 수 없습니다. 실장 배정 후 다시 시도하세요.",
          },
          { status: 409 },
        )
      }
    }

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
    await writeSessionAudit(supabase, {
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
    })

    if (result.participants_closed_count > 0) {
      await writeSessionAudit(supabase, {
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
      })
    }

    if (result.chat_closed) {
      // NOTE: post-cutover audit entity_id is the session_id rather than the
      // chat_room.id returned by the previous app-layer SELECT. The chat_rooms
      // row is 1:1 with session_id for type='room_session', so lookups by
      // session_id remain unambiguous. Minor semantic drift preserved
      // intentionally to avoid a second round-trip to recover the chat row id.
      await writeSessionAudit(supabase, {
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
