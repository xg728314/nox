/**
 * POST /api/chat/pattern-dispatch
 *
 * 채팅 메시지 자동 인식 → 임시 등록 (chat_pattern_dispatches rows 생성).
 *   기존 즉시 dispatch 대체.
 *
 * Body:
 *   {
 *     chat_message_id: string,
 *     entries: [
 *       { target_store_uuid, hostess_membership_id, category, time_type }
 *     ]
 *   }
 *
 * 권한: 발신자 본인 (chat_message.sender 와 auth.user_id 동일) 또는 super_admin.
 *
 * 응답:
 *   { ok, dispatches: [{ id, target_store_uuid, status }] }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

type Entry = {
  target_store_uuid?: string
  hostess_membership_id?: string
  category?: string
  time_type?: string
}

const CAT_SET = new Set(["퍼블릭", "셔츠", "하퍼"])
const TIME_SET = new Set(["기본", "반티", "차3"])

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      chat_message_id?: string
      entries?: Entry[]
    }
    if (!body.chat_message_id || !isValidUUID(body.chat_message_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "chat_message_id required" }, { status: 400 })
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "entries required" }, { status: 400 })
    }
    const supabase = getServiceClient()

    // 1. 메시지 검증 (chat_room_id 추출 + 발신자/super_admin 권한)
    const { data: msg } = await supabase
      .from("chat_messages")
      .select("id, chat_room_id, sender_membership_id")
      .eq("id", body.chat_message_id)
      .maybeSingle()
    if (!msg) {
      return NextResponse.json({ error: "MESSAGE_NOT_FOUND" }, { status: 404 })
    }
    const m = msg as { id: string; chat_room_id: string; sender_membership_id: string | null }
    if (!auth.is_super_admin && m.sender_membership_id !== auth.membership_id) {
      return NextResponse.json({ error: "NOT_SENDER" }, { status: 403 })
    }

    // 2. 멱등 — 이미 같은 메시지로 임시 등록 row 가 있으면 그대로 반환
    const { data: existing } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, target_store_uuid, status, target_confirmed_by")
      .eq("chat_message_id", body.chat_message_id)
      .is("deleted_at", null)
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, dispatches: existing, already: true })
    }

    // 3. entries validate + INSERT 임시 등록 row 들
    const rows: Array<{
      chat_message_id: string
      chat_room_id: string
      target_store_uuid: string
      hostess_membership_id: string
      category: string
      time_type: string
      created_by: string
      status: string
    }> = []
    const validateErr: string[] = []
    for (const e of body.entries) {
      if (!e.target_store_uuid || !isValidUUID(e.target_store_uuid)) { validateErr.push("target_store_uuid invalid"); continue }
      if (!e.hostess_membership_id || !isValidUUID(e.hostess_membership_id)) { validateErr.push("hostess invalid"); continue }
      if (!e.category || !CAT_SET.has(e.category)) { validateErr.push("category invalid"); continue }
      if (!e.time_type || !TIME_SET.has(e.time_type)) { validateErr.push("time_type invalid"); continue }
      rows.push({
        chat_message_id: body.chat_message_id,
        chat_room_id: m.chat_room_id,
        target_store_uuid: e.target_store_uuid,
        hostess_membership_id: e.hostess_membership_id,
        category: e.category,
        time_type: e.time_type,
        created_by: auth.user_id,
        status: "pending",
      })
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: validateErr.join("; ") }, { status: 400 })
    }

    const { data: inserted, error: insErr } = await supabase
      .from("chat_pattern_dispatches")
      .insert(rows)
      .select("id, target_store_uuid, status, target_confirmed_by")
    if (insErr) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr.message }, { status: 500 })
    }

    // R-auto-confirm-server (2026-06-27): 발신자가 super_admin/owner 면 server-side
    //   에서 자동 confirm 호출 → 즉시 cross-store dispatch 실행. 클라이언트 측
    //   자동 confirm 은 me.data 로딩 시점 의존 + silent fail 가능 → server side 가
    //   더 robust. 사용자 요구: "외부 실장이 거절 안 하면 외부 식구 목록에 떠야".
    const insertedRows = (inserted ?? []) as Array<{ id: string; target_store_uuid: string; status: string }>
    const isAutoActor = auth.is_super_admin || auth.role === "owner"
    if (isAutoActor && insertedRows.length > 0) {
      const origin = new URL(request.url).origin
      const cookieHeader = request.headers.get("cookie") ?? ""
      const authHeader = request.headers.get("authorization") ?? ""
      // 직렬 호출 — 마지막 호출 시 모든 row 가 confirm 돼서 execute 실행.
      for (const d of insertedRows) {
        try {
          await fetch(`${origin}/api/chat/pattern-dispatch/${d.id}/confirm`, {
            method: "POST",
            headers: {
              ...(cookieHeader ? { cookie: cookieHeader } : {}),
              ...(authHeader ? { authorization: authHeader } : {}),
            },
          })
        } catch {
          // 개별 실패 무시 — 사용자에게 노출 X (UI 가 polling 으로 상태 봄)
        }
      }
      // 최신 상태 다시 조회 (executed_session_id 등 채워진 후)
      const { data: latest } = await supabase
        .from("chat_pattern_dispatches")
        .select("id, target_store_uuid, hostess_membership_id, category, time_type, status, target_confirmed_by, executed_session_id")
        .in("id", insertedRows.map((d) => d.id))
      return NextResponse.json({
        ok: true,
        dispatches: latest ?? insertedRows,
        auto_executed: true,
      }, { status: 201 })
    }

    return NextResponse.json({ ok: true, dispatches: insertedRows }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}

/**
 * GET /api/chat/pattern-dispatch?chat_message_id=...
 *
 * 메시지의 임시 등록 row 들 조회 — 카드 UI 갱신용.
 */
export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const mid = url.searchParams.get("chat_message_id")
    if (!mid || !isValidUUID(mid)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const { data: rows } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, target_store_uuid, hostess_membership_id, category, time_type, status, target_confirmed_by, target_confirmed_at, executed_session_id")
      .eq("chat_message_id", mid)
      .is("deleted_at", null)
    return NextResponse.json({ dispatches: rows ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
