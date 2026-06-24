/**
 * PATCH /api/chat/rooms/[id]/pattern-toggle
 *
 * super_admin 만 호출 가능 — 메이드 패턴 자동 인식 활성화/비활성화 토글.
 *   chat_rooms.pattern_enabled 컬럼 토글.
 *
 * Body: { enabled?: boolean }  // 미지정 시 현재값 반전
 * 응답: { ok: true, chat_room_id, pattern_enabled }
 *
 * 컬럼 미적용 환경 (migration 114 미실행) 대응:
 *   42703 / PGRST204 → ok: false + migration_required: true 응답.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === "42703" || err.code === "PGRST204") return true
  const m = err.message ?? ""
  return /schema cache|Could not find the '/.test(m)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "운영자만 사용 가능합니다." }, { status: 403 })
    }
    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    let body: { enabled?: boolean }
    try { body = await request.json() } catch { body = {} }

    const supabase = getServiceClient()

    // 현재값 조회 (반전용)
    const { data: row, error: getErr } = await supabase
      .from("chat_rooms")
      .select("id, pattern_enabled")
      .eq("id", id)
      .maybeSingle()
    if (getErr && isMissingColumn(getErr)) {
      return NextResponse.json({
        ok: false,
        error: "MIGRATION_REQUIRED",
        message: "database/114_chat_rooms_pattern_enabled.sql 적용 필요.",
      }, { status: 503 })
    }
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    type Row = { id: string; pattern_enabled?: boolean }
    const next = typeof body.enabled === "boolean" ? body.enabled : !((row as Row).pattern_enabled ?? false)

    const { error: updErr } = await supabase
      .from("chat_rooms")
      .update({ pattern_enabled: next })
      .eq("id", id)
    if (updErr) {
      if (isMissingColumn(updErr)) {
        return NextResponse.json({
          ok: false,
          error: "MIGRATION_REQUIRED",
          message: "database/114_chat_rooms_pattern_enabled.sql 적용 필요.",
        }, { status: 503 })
      }
      return NextResponse.json({ error: "UPDATE_FAILED", message: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, chat_room_id: id, pattern_enabled: next })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}

/**
 * GET /api/chat/rooms/[id]/pattern-toggle
 *
 * 채팅방의 pattern_enabled 상태 조회. 모든 인증된 사용자.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await resolveAuthContext(request)
    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const { data: row, error } = await supabase
      .from("chat_rooms")
      .select("id, pattern_enabled")
      .eq("id", id)
      .maybeSingle()
    if (error && isMissingColumn(error)) {
      // graceful fallback — 컬럼 없으면 비활성으로 간주
      return NextResponse.json({ chat_room_id: id, pattern_enabled: false, migration_required: true })
    }
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    type Row = { id: string; pattern_enabled?: boolean }
    return NextResponse.json({ chat_room_id: id, pattern_enabled: (row as Row).pattern_enabled ?? false })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
