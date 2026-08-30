/**
 * POST /api/sessions/[session_id]/lock
 *
 * Body: { locked: boolean }
 *
 * R-room-lock (2026-08-31): 방(세션) 편집 잠금 toggle. 같은 매장 실장 사고 방지.
 *
 * 규칙:
 *   - locked=true: 잠금 획득. 이미 다른 사람 잠금 있으면 409 (owner/super_admin 예외 · 강제 인수).
 *   - locked=false: 잠금 해제. 잠금 소유자 or owner or super_admin 만 가능.
 *   - hostess role 차단.
 *
 * 응답: { ok, session_id, locked_by_membership_id, locked_at }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { session_id } = await params
    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id required" }, { status: 400 })
    }
    const parsed = await parseJsonBody<{ locked?: boolean }>(request)
    if (parsed.error) return parsed.error
    const wantLock = parsed.body.locked === true

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: sess, error: sErr } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status, locked_by_membership_id")
      .eq("id", session_id)
      .maybeSingle()
    if (sErr) {
      const code = (sErr as { code?: string }).code
      if (code === "42703") {
        return NextResponse.json({
          error: "MIGRATION_REQUIRED",
          message: "방 잠금 기능 사용 전 migration 094 적용 필요.",
        }, { status: 501 })
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: sErr.message }, { status: 500 })
    }
    if (!sess) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (!auth.is_super_admin && sess.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }
    if (sess.status !== "active") {
      return NextResponse.json({ error: "SESSION_NOT_ACTIVE" }, { status: 409 })
    }

    const currentLock = sess.locked_by_membership_id as string | null
    const isOwnerOrSuper = auth.role === "owner" || auth.is_super_admin

    let payload: { locked_by_membership_id: string | null; locked_at: string | null }
    if (wantLock) {
      // 잠금 획득
      if (currentLock && currentLock !== auth.membership_id && !isOwnerOrSuper) {
        return NextResponse.json({
          error: "ALREADY_LOCKED",
          message: "다른 실장이 이미 잠금 중입니다. 사장/실장 본인만 해제 가능.",
        }, { status: 409 })
      }
      payload = { locked_by_membership_id: auth.membership_id, locked_at: new Date().toISOString() }
    } else {
      // 잠금 해제
      if (!currentLock) {
        // no-op
        return NextResponse.json({ ok: true, session_id, locked_by_membership_id: null, locked_at: null, no_op: true })
      }
      if (currentLock !== auth.membership_id && !isOwnerOrSuper) {
        return NextResponse.json({
          error: "NOT_LOCK_OWNER",
          message: "잠금 소유자만 해제 가능 (사장은 언제든 override).",
        }, { status: 403 })
      }
      payload = { locked_by_membership_id: null, locked_at: null }
    }

    const { error: upErr } = await supabase
      .from("room_sessions")
      .update(payload)
      .eq("id", session_id)
    if (upErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
    }

    void writeSessionAudit(supabase, {
      auth,
      session_id,
      entity_table: "room_sessions",
      entity_id: session_id,
      action: wantLock ? "session_locked" : "session_unlocked",
      before: { locked_by_membership_id: currentLock },
      after: { locked_by_membership_id: payload.locked_by_membership_id },
    }).catch((e) => console.warn("[lock] audit:", e instanceof Error ? e.message : e))

    invalidateCache("rooms")
    invalidateCache("building_rooms")

    return NextResponse.json({
      ok: true,
      session_id,
      locked_by_membership_id: payload.locked_by_membership_id,
      locked_at: payload.locked_at,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: (error as Error).message },
      { status: 500 },
    )
  }
}
