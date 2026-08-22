/**
 * Sprint 4 (2026-07-29): Pending macro_confirm 승인
 *
 * POST /api/chat/messages/[message_id]/confirm-macro
 *   실장이 pending 파싱 결과 확정 → 세션 등록 + 매크로 발행 + alias 학습
 *
 *   body: optional overrides
 *     { room_no?: string, entries_override?: [{hostess_membership_id, category, ticket_type}, ...] }
 *
 * 흐름:
 *   1. macro_confirm message + macro_context 조회
 *   2. entries 확정 (override or 원본)
 *   3. 세션 등록 (기존 활성 재사용 or checkin) + 참여자 INSERT
 *   4. 원 macro_confirm superseded_at 스탬프
 *   5. 신규 macro_maid 발행 (broadcast_queue enqueue)
 *   6. alias 학습 (from_text → resolved hostess)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { enqueueBroadcast } from "@/lib/chat/broadcastQueue"
import { refreshStoreChoiceState } from "@/lib/chat/publishChoiceState"
import { isValidUUID } from "@/lib/validation"

type ConfirmedEntry = {
  name: string
  hostess_membership_id: string | null
  category: string | null
  ticket_type: string | null
  from_text?: string  // 원본 파싱 name (alias 학습용)
  needs_provisioning?: boolean
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ message_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { message_id } = await params
    if (!isValidUUID(message_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      room_no?: string
      entries_override?: ConfirmedEntry[]
    }

    const sb = getServiceClient()

    const { data: msgData, error } = await sb
      .from("chat_messages")
      .select("id, store_uuid, chat_room_id, message_type, macro_context, superseded_at, deleted_at")
      .eq("id", message_id)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    const msg = msgData as {
      id: string
      store_uuid: string
      chat_room_id: string
      message_type: string
      macro_context: Record<string, unknown> | null
      superseded_at: string | null
      deleted_at: string | null
    } | null
    if (!msg) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (msg.deleted_at) return NextResponse.json({ error: "ALREADY_DELETED" }, { status: 410 })
    if (msg.superseded_at) return NextResponse.json({ error: "ALREADY_HANDLED" }, { status: 409 })
    if (msg.message_type !== "macro_confirm") {
      return NextResponse.json({ error: "NOT_CONFIRMABLE", message: "macro_confirm 만 승인 가능" }, { status: 400 })
    }
    if (!auth.is_super_admin && msg.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
    }

    // macro_context 에서 원본 파싱 결과 추출
    const ctx = (msg.macro_context ?? {}) as {
      resolved_entries?: ConfirmedEntry[]
      raw_text?: string
      room_no?: string
      store_uuid?: string
      confidence?: number
    }
    const originalEntries = ctx.resolved_entries ?? []
    const finalEntries = body.entries_override ?? originalEntries
    if (finalEntries.length === 0) {
      return NextResponse.json({ error: "NO_ENTRIES" }, { status: 400 })
    }
    const targetStore = ctx.store_uuid ?? msg.store_uuid
    const roomNo = body.room_no ?? ctx.room_no ?? null

    // 방 찾기
    let roomUuid: string | null = null
    if (roomNo) {
      const { data: rooms } = await sb
        .from("rooms")
        .select("id")
        .eq("store_uuid", targetStore)
        .eq("room_no", roomNo)
        .is("deleted_at", null)
        .limit(1)
      const rows = (rooms ?? []) as Array<{ id: string }>
      if (rows.length > 0) roomUuid = rows[0].id
    }
    if (!roomUuid) {
      return NextResponse.json({ error: "ROOM_NOT_FOUND", message: "방번호를 다시 확인해주세요" }, { status: 400 })
    }

    // 세션 확보 (existing 재사용 or 신규)
    let sessionId: string | null = null
    const { data: existSess } = await sb
      .from("room_sessions")
      .select("id")
      .eq("room_uuid", roomUuid)
      .eq("status", "active")
      .is("archived_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existSess) sessionId = (existSess as { id: string }).id
    const nowIso = new Date().toISOString()
    if (!sessionId) {
      const { data: bd } = await sb
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", targetStore)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      const businessDayId = (bd as { id?: string } | null)?.id
      if (!businessDayId) return NextResponse.json({ error: "NO_BUSINESS_DAY" }, { status: 400 })
      const { data: newSess, error: sErr } = await sb
        .from("room_sessions")
        .insert({
          store_uuid: targetStore,
          room_uuid: roomUuid,
          business_day_id: businessDayId,
          status: "active",
          started_at: nowIso,
          manager_membership_id: auth.membership_id,
        })
        .select("id")
        .single()
      if (sErr || !newSess) {
        return NextResponse.json({ error: "SESSION_CREATE_FAILED", message: sErr?.message }, { status: 500 })
      }
      sessionId = (newSess as { id: string }).id
    }

    // 참여자 등록
    const inserted: Array<{ id: string }> = []
    for (const e of finalEntries) {
      const { data: p } = await sb
        .from("session_participants")
        .insert({
          session_id: sessionId,
          store_uuid: targetStore,
          role: "hostess",
          category: e.category ?? null,
          time_minutes: ticketMinutes(e.ticket_type, e.category),
          price_amount: 0,
          manager_payout_amount: 0,
          hostess_payout_amount: 0,
          cha3_amount: 0,
          banti_amount: 0,
          waiter_tip_received: false,
          waiter_tip_amount: 0,
          greeting_confirmed: e.category === "셔츠",
          status: "active",
          entered_at: nowIso,
          membership_id: e.hostess_membership_id,
          external_name: e.hostess_membership_id ? null : e.name,
          memo: e.needs_provisioning ? `pending 승인 · ${e.name}` : null,
        })
        .select("id")
        .maybeSingle()
      if (p) inserted.push(p as { id: string })
    }

    // 원 macro_confirm superseded 처리
    await sb
      .from("chat_messages")
      .update({ superseded_at: nowIso })
      .eq("id", message_id)

    // 신규 macro_maid enqueue
    const macroContent = renderMaidMacro(finalEntries, roomNo)
    const eq = await enqueueBroadcast({
      chat_room_id: msg.chat_room_id,
      store_uuid: targetStore,
      message_type: "macro_maid",
      content: macroContent,
      sender_membership_id: auth.membership_id,
      session_id: sessionId,
      macro_context: {
        source: "pending_confirmed",
        original_confirm_message_id: message_id,
        entries: finalEntries,
      },
    })

    // Alias 학습 (from_text 있으면)
    for (const e of finalEntries) {
      if (e.from_text && e.from_text !== e.name && e.hostess_membership_id) {
        try {
          await sb
            .from("alias_learnings")
            .upsert({
              scope: "store",
              scope_id: targetStore,
              from_text: e.from_text,
              resolved_type: "hostess",
              resolved_id: e.hostess_membership_id,
              resolved_value: e.name,
              confirmed_count: 1,
              last_used_at: nowIso,
            }, { onConflict: "scope,scope_id,from_text,resolved_type", ignoreDuplicates: false })
        } catch { /* silent · migration 미apply */ }
      }
    }

    // 매장 초이스 상태 refresh
    void refreshStoreChoiceState(targetStore).catch(() => { /* silent */ })

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      participants: inserted,
      broadcast_queue_id: eq.queue_id ?? null,
      superseded_message_id: message_id,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

function ticketMinutes(t: string | null, cat: string | null): number {
  if (!t) return 60
  if (t === "차3" || t === "차") return 15
  if (t === "반티" || t === "반") return cat === "퍼블릭" ? 45 : 30
  if (t === "반차3") return cat === "퍼블릭" ? 45 : 30
  return cat === "퍼블릭" ? 90 : 60
}

function renderMaidMacro(entries: ConfirmedEntry[], roomNo: string | null): string {
  const names = entries.map((e) => e.name).filter(Boolean).join("·")
  const category = entries[0]?.category ?? ""
  const ticket = entries[0]?.ticket_type ?? ""
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, "0")
  const mm = String(t.getMinutes()).padStart(2, "0")
  const parts: string[] = ["✅ (확인)"]
  if (roomNo) parts.push(`${roomNo}번방`)
  if (names) parts.push(names)
  if (category) parts.push(category)
  if (ticket) parts.push(ticket)
  parts.push(`(${hh}:${mm})`)
  return parts.join(" · ")
}
