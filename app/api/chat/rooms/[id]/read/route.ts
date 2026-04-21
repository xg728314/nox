import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { loadRoomScoped } from "@/lib/chat/queries/loadRoomScoped"
import { verifyActiveParticipant } from "@/lib/chat/validators/validateRoomAccess"
import { updateUnreadState } from "@/lib/chat/services/updateUnreadState"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    const { id: roomId } = await params
    if (!isValidUUID(roomId)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Room scope check (allow closed rooms for post-checkout badge clearing)
    const roomResult = await loadRoomScoped(supabase, roomId, auth.store_uuid, { allowClosed: true })
    if (roomResult.error) return roomResult.error

    // Participant check
    const participantError = await verifyActiveParticipant(supabase, roomId, auth.membership_id)
    if (participantError) return participantError

    // Mark as read
    const result = await updateUnreadState(supabase, {
      store_uuid: auth.store_uuid,
      roomId,
      membership_id: auth.membership_id,
    })

    return NextResponse.json({
      success: true,
      room_id: roomId,
      last_read_message_id: result.last_read_message_id,
      read_at: result.read_at,
    })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/read")
  }
}
