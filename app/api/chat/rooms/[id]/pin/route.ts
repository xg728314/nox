import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  try {
    const authContext = await resolveAuthContext(request)

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid chat room id." }, { status: 400 })
    }

    const parsed = await parseJsonBody<{ pinned?: unknown }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    if (typeof body.pinned !== "boolean") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "pinned must be a boolean." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const nextPinnedAt = body.pinned ? new Date().toISOString() : null

    const { data: updated, error: updateErr } = await supabase
      .from("chat_participants")
      .update({ pinned_at: nextPinnedAt })
      .eq("chat_room_id", id)
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("left_at", null)
      .select("id, pinned_at")

    if (updateErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updateErr.message }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "NOT_PARTICIPANT", message: "이 채팅방의 참여자가 아닙니다." }, { status: 403 })
    }

    return NextResponse.json({
      chat_room_id: id,
      pinned_at: updated[0].pinned_at,
    })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/pin")
  }
}
