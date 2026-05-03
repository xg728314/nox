import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { loadRoomScoped, type ChatRoomRow } from "@/lib/chat/queries/loadRoomScoped"
import { verifyActiveParticipant } from "@/lib/chat/validators/validateRoomAccess"
import { resolveMemberNamesWithRole } from "@/lib/chat/queries/loadRoomMembers"
import type { SupabaseClient } from "@supabase/supabase-js"

type Params = { params: Promise<{ id: string }> }

/**
 * Permission check: group room + creator/owner for mutations, active participant for reads.
 */
async function resolveRoomAndPermission(
  chatRoomId: string,
  authContext: Awaited<ReturnType<typeof resolveAuthContext>>,
  supabase: SupabaseClient,
  requireMutationPermission: boolean
): Promise<{ room: ChatRoomRow } | { error: ReturnType<typeof NextResponse.json> }> {
  if (!isValidUUID(chatRoomId)) {
    return { error: NextResponse.json({ error: "BAD_REQUEST", message: "invalid chat room id." }, { status: 400 }) }
  }

  const roomResult = await loadRoomScoped(supabase, chatRoomId, authContext.store_uuid)
  if (roomResult.error) return { error: roomResult.error }
  const room = roomResult.room

  if (room.type !== "group") {
    return { error: NextResponse.json({ error: "NOT_GROUP_ROOM", message: "group 채팅만 관리할 수 있습니다." }, { status: 400 }) }
  }

  if (requireMutationPermission) {
    const isCreator = room.created_by === authContext.membership_id
    const isOwner = authContext.role === "owner"
    if (!isCreator && !isOwner) {
      return { error: NextResponse.json({ error: "ROLE_FORBIDDEN", message: "멤버 관리는 생성자 또는 사장만 가능합니다." }, { status: 403 }) }
    }
  } else {
    const participantError = await verifyActiveParticipant(supabase, chatRoomId, authContext.membership_id)
    if (participantError) return { error: participantError }
  }

  return { room }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const authContext = await resolveAuthContext(request)
    const { id } = await params

    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid chat room id." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-03 R-Speed-x10: room load + participant verify + parts list 3개 병렬.
    //   기존: room → participant → parts → names (4 wave 직렬).
    //   현재: 첫 3개 동시 fire — chatRoomId + membership_id 만 의존 (서로 무관).
    //   → 1 wave + names 1 wave = 총 2 wave.
    const [roomResult, participantError, partsRes] = await Promise.all([
      loadRoomScoped(supabase, id, authContext.store_uuid),
      verifyActiveParticipant(supabase, id, authContext.membership_id),
      supabase
        .from("chat_participants")
        .select("id, membership_id, joined_at, unread_count")
        .eq("chat_room_id", id)
        .is("left_at", null),
    ])
    if (roomResult.error) return roomResult.error
    if (participantError) return participantError
    const room = roomResult.room
    if (room.type !== "group") {
      return NextResponse.json(
        { error: "NOT_GROUP_ROOM", message: "group 채팅만 관리할 수 있습니다." },
        { status: 400 },
      )
    }

    const parts = partsRes.data ?? []
    const memberIds = parts.map((p: { membership_id: string }) => p.membership_id)
    const nameMap = await resolveMemberNamesWithRole(supabase, authContext.store_uuid, memberIds)

    const enriched = parts.map((p: { id: string; membership_id: string; joined_at: string }) => ({
      id: p.id,
      membership_id: p.membership_id,
      name: nameMap.get(p.membership_id)?.name ?? null,
      role: nameMap.get(p.membership_id)?.role ?? null,
      joined_at: p.joined_at,
    }))

    return NextResponse.json({ participants: enriched })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/participants")
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { id } = await params

    const parsed = await parseJsonBody<{ member_ids?: unknown }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const rawIds = body.member_ids
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "member_ids is required." }, { status: 400 })
    }
    const memberIds: string[] = []
    for (const x of rawIds) {
      if (typeof x !== "string" || !isValidUUID(x)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "member_ids must be valid UUIDs." }, { status: 400 })
      }
      memberIds.push(x)
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const guard = await resolveRoomAndPermission(id, authContext, supabase, true)
    if ("error" in guard) return guard.error

    // Validate members: same store + approved + not deleted
    const unique = Array.from(new Set(memberIds))
    const { data: verified } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "approved")
      .is("deleted_at", null)
      .in("id", unique)
    const verifiedIds = new Set((verified ?? []).map((m: { id: string }) => m.id))
    if (verifiedIds.size !== unique.length) {
      return NextResponse.json(
        { error: "INVALID_MEMBERS", message: "유효하지 않은 멤버가 포함되어 있습니다." },
        { status: 400 }
      )
    }

    // Existing rows (including soft-left)
    const { data: existing } = await supabase
      .from("chat_participants")
      .select("id, membership_id, left_at")
      .eq("chat_room_id", id)
      .in("membership_id", unique)

    const existingMap = new Map<string, { id: string; left_at: string | null }>()
    for (const e of (existing ?? []) as { id: string; membership_id: string; left_at: string | null }[]) {
      existingMap.set(e.membership_id, { id: e.id, left_at: e.left_at })
    }

    const toReactivate: string[] = []
    const toInsert: string[] = []
    for (const mid of unique) {
      const row = existingMap.get(mid)
      if (!row) {
        toInsert.push(mid)
      } else if (row.left_at !== null) {
        toReactivate.push(row.id)
      }
    }

    if (toReactivate.length > 0) {
      await supabase
        .from("chat_participants")
        .update({ left_at: null, unread_count: 0 })
        .in("id", toReactivate)
    }

    if (toInsert.length > 0) {
      await supabase
        .from("chat_participants")
        .insert(toInsert.map(mid => ({
          chat_room_id: id,
          membership_id: mid,
          store_uuid: authContext.store_uuid,
        })))
    }

    return NextResponse.json({
      chat_room_id: id,
      added: toInsert.length,
      reactivated: toReactivate.length,
    }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/participants")
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const targetMembershipId = searchParams.get("membership_id")

    if (!targetMembershipId || !isValidUUID(targetMembershipId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id is required." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const guard = await resolveRoomAndPermission(id, authContext, supabase, true)
    if ("error" in guard) return guard.error
    const { room } = guard

    // Creator cannot be removed
    if (targetMembershipId === room.created_by) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "생성자는 제거할 수 없습니다." },
        { status: 400 }
      )
    }

    const { data: updated } = await supabase
      .from("chat_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("chat_room_id", id)
      .eq("membership_id", targetMembershipId)
      .is("left_at", null)
      .select("id")

    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "NOT_PARTICIPANT" }, { status: 404 })
    }

    return NextResponse.json({ chat_room_id: id, removed_membership_id: targetMembershipId }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/participants")
  }
}
