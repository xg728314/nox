/**
 * GET /api/choice-talk/rooms/[id]/messages    메시지 목록
 * POST /api/choice-talk/rooms/[id]/messages   메시지 전송. body: { body?, image_url? }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    // 참여자 확인
    const { data: room } = await supabase
      .from("choice_talk_rooms")
      .select("initiator_user_id, counterparty_user_id")
      .eq("id", id)
      .maybeSingle()
    if (!room) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    const r = room as { initiator_user_id: string; counterparty_user_id: string | null }
    if (r.initiator_user_id !== auth.user_id && r.counterparty_user_id !== auth.user_id
        && !auth.is_super_admin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const { data } = await supabase
      .from("choice_talk_messages")
      .select("id, sender_user_id, body, image_url, created_at")
      .eq("room_id", id)
      .order("created_at", { ascending: true })
      .limit(200)
    // 내 unread reset
    const updateField =
      auth.user_id === r.initiator_user_id ? "initiator_unread" : "counterparty_unread"
    await supabase
      .from("choice_talk_rooms")
      .update({ [updateField]: 0 })
      .eq("id", id)
    return NextResponse.json({ messages: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as { body?: string; image_url?: string }
    if (!body.body?.trim() && !body.image_url) {
      return NextResponse.json({ error: "EMPTY" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const { data: room } = await supabase
      .from("choice_talk_rooms")
      .select("initiator_user_id, counterparty_user_id")
      .eq("id", id)
      .maybeSingle()
    if (!room) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    const r = room as { initiator_user_id: string; counterparty_user_id: string | null }
    if (r.initiator_user_id !== auth.user_id && r.counterparty_user_id !== auth.user_id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const { data: created, error } = await supabase
      .from("choice_talk_messages")
      .insert({
        room_id: id,
        sender_user_id: auth.user_id,
        body: body.body?.trim() ?? null,
        image_url: body.image_url ?? null,
      })
      .select("id")
      .single()
    if (error) {
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    // last_message_at + 상대 unread++
    const otherUnread =
      auth.user_id === r.initiator_user_id ? "counterparty_unread" : "initiator_unread"
    const { data: cur } = await supabase
      .from("choice_talk_rooms")
      .select(otherUnread)
      .eq("id", id)
      .maybeSingle()
    const curUnread = (cur as Record<string, number> | null)?.[otherUnread] ?? 0
    await supabase
      .from("choice_talk_rooms")
      .update({
        last_message_at: new Date().toISOString(),
        [otherUnread]: curUnread + 1,
      })
      .eq("id", id)
    return NextResponse.json({ ok: true, id: (created as { id: string }).id })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
