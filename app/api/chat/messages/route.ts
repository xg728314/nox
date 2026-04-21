import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { loadRoomScoped } from "@/lib/chat/queries/loadRoomScoped"
import { verifyActiveParticipant, verifyHostessSessionAccess } from "@/lib/chat/validators/validateRoomAccess"
import { validateMessageInput } from "@/lib/chat/validators/validateMessageInput"
import { sendMessage } from "@/lib/chat/services/sendMessage"
import { getMessages } from "@/lib/chat/services/getMessages"

/**
 * POST /api/chat/messages — 메시지 전송
 * GET  /api/chat/messages?chat_room_id=xxx&cursor=xxx&limit=50 — 이력 조회
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const parsed = await parseJsonBody<{ chat_room_id?: string; content?: string }>(request)
    if (parsed.error) return parsed.error
    const { chat_room_id, content } = parsed.body

    // Input validation
    const inputError = validateMessageInput(chat_room_id, content)
    if (inputError) return inputError

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Room lookup + active check
    const roomResult = await loadRoomScoped(supabase, chat_room_id!, authContext.store_uuid)
    if (roomResult.error) return roomResult.error
    const chatRoom = roomResult.room

    // Hostess defense-in-depth
    if (authContext.role === "hostess" && chatRoom.type === "room_session" && chatRoom.session_id) {
      const guard = await verifyHostessSessionAccess(supabase, chatRoom.session_id, authContext.membership_id, authContext.store_uuid)
      if (guard) return guard
    }

    // Participant check
    const participantError = await verifyActiveParticipant(supabase, chat_room_id!, authContext.membership_id)
    if (participantError) return participantError

    // Send message
    const result = await sendMessage(supabase, {
      chat_room_id: chat_room_id!,
      store_uuid: authContext.store_uuid,
      sender_membership_id: authContext.membership_id,
      content: content!,
    })
    if (result.error) return result.error

    return NextResponse.json({
      message_id: result.message.id,
      chat_room_id: result.message.chat_room_id,
      sender_membership_id: result.message.sender_membership_id,
      content: result.message.content,
      message_type: result.message.message_type,
      created_at: result.message.created_at,
    }, { status: 201 })
  } catch (error) {
    return handleRouteError(error, "chat/messages")
  }
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const { searchParams } = new URL(request.url)
    const chatRoomId = searchParams.get("chat_room_id")
    const cursor = searchParams.get("cursor")
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100)

    if (!chatRoomId || !isValidUUID(chatRoomId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "chat_room_id is required." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Room lookup + active check
    const roomResult = await loadRoomScoped(supabase, chatRoomId, authContext.store_uuid)
    if (roomResult.error) return roomResult.error
    const chatRoom = roomResult.room

    // Participant check
    const participantError = await verifyActiveParticipant(supabase, chatRoomId, authContext.membership_id)
    if (participantError) return participantError

    // Hostess defense-in-depth
    if (authContext.role === "hostess" && chatRoom.type === "room_session" && chatRoom.session_id) {
      const guard = await verifyHostessSessionAccess(supabase, chatRoom.session_id, authContext.membership_id, authContext.store_uuid)
      if (guard) return guard
    }

    // Fetch messages with enrichment
    const result = await getMessages(supabase, {
      chatRoomId,
      store_uuid: authContext.store_uuid,
      membership_id: authContext.membership_id,
      cursor,
      limit,
    })

    // Auto mark-as-read on initial page load (no cursor)
    if (!cursor && result.latestMessageId) {
      await supabase
        .from("chat_participants")
        .update({ unread_count: 0, last_read_message_id: result.latestMessageId })
        .eq("chat_room_id", chatRoomId)
        .eq("membership_id", authContext.membership_id)
    }

    return NextResponse.json({
      chat_room_id: chatRoomId,
      messages: result.messages,
      has_more: result.has_more,
    })
  } catch (error) {
    return handleRouteError(error, "chat/messages")
  }
}
