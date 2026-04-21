import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { getRoomList } from "@/lib/chat/services/getRoomList"
import { verifyHostessSessionAccess } from "@/lib/chat/validators/validateRoomAccess"

const VALID_TYPES = ["global", "group", "room_session", "direct"] as const

/**
 * GET  /api/chat/rooms — 내 채팅방 목록
 * POST /api/chat/rooms — 채팅방 생성 또는 기존 방 반환
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const rooms = await getRoomList(supabase, authContext.store_uuid, authContext.membership_id)

    return NextResponse.json({ rooms })
  } catch (error) {
    return handleRouteError(error, "chat/rooms")
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const parsed = await parseJsonBody<{
      type?: string
      session_id?: string
      target_membership_id?: string
      name?: string
      member_ids?: string[]
    }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const { session_id, target_membership_id } = body
    // Accept "room" as legacy alias for "room_session"
    const type = body.type === "room" ? "room_session" : body.type

    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "type must be one of: global, group, room_session, direct." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // === GLOBAL ===
    if (type === "global") {
      const { data: existing } = await supabase
        .from("chat_rooms")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("type", "global")
        .maybeSingle()

      let roomId: string

      if (existing) {
        roomId = existing.id
      } else {
        const { data: created, error: createErr } = await supabase
          .from("chat_rooms")
          .insert({
            store_uuid: authContext.store_uuid,
            type: "global",
            name: "매장 전체",
            created_by: authContext.membership_id,
          })
          .select("id")
          .single()

        if (createErr || !created) {
          return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
        }
        roomId = created.id
      }

      await supabase
        .from("chat_participants")
        .upsert({
          chat_room_id: roomId,
          membership_id: authContext.membership_id,
          store_uuid: authContext.store_uuid,
        }, { onConflict: "chat_room_id,membership_id" })

      return NextResponse.json({ chat_room_id: roomId, type: "global" }, { status: 200 })
    }

    // === ROOM_SESSION ===
    if (type === "room_session") {
      if (!session_id || !isValidUUID(session_id)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "session_id is required for room_session type." }, { status: 400 })
      }

      const { data: session } = await supabase
        .from("room_sessions")
        .select("id, room_uuid")
        .eq("id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .maybeSingle()

      if (!session) {
        return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
      }

      // Hostess access restriction
      if (authContext.role === "hostess") {
        const guard = await verifyHostessSessionAccess(supabase, session_id, authContext.membership_id, authContext.store_uuid)
        if (guard) return guard
      }

      const { data: room } = await supabase
        .from("rooms").select("name").eq("id", session.room_uuid).maybeSingle()

      const { data: existing } = await supabase
        .from("chat_rooms")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("type", "room_session")
        .eq("session_id", session_id)
        .eq("is_active", true)
        .maybeSingle()

      let roomId: string

      if (existing) {
        roomId = existing.id
      } else {
        const { data: created, error: createErr } = await supabase
          .from("chat_rooms")
          .insert({
            store_uuid: authContext.store_uuid,
            type: "room_session",
            session_id,
            room_uuid: session.room_uuid,
            name: room?.name ? `${room.name} 채팅` : "룸 채팅",
            created_by: authContext.membership_id,
          })
          .select("id")
          .single()

        if (createErr) {
          const pgCode = (createErr as { code?: string }).code
          if (pgCode === "23505") {
            const { data: raceWinner } = await supabase
              .from("chat_rooms")
              .select("id")
              .eq("store_uuid", authContext.store_uuid)
              .eq("type", "room_session")
              .eq("session_id", session_id)
              .eq("is_active", true)
              .maybeSingle()
            if (!raceWinner) {
              return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
            }
            roomId = raceWinner.id
          } else {
            return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
          }
        } else if (!created) {
          return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
        } else {
          roomId = created.id
        }
      }

      await supabase
        .from("chat_participants")
        .upsert({
          chat_room_id: roomId,
          membership_id: authContext.membership_id,
          store_uuid: authContext.store_uuid,
        }, { onConflict: "chat_room_id,membership_id" })

      return NextResponse.json({ chat_room_id: roomId, type: "room_session", session_id }, { status: 200 })
    }

    // === GROUP ===
    if (type === "group") {
      if (authContext.role === "hostess") {
        return NextResponse.json(
          { error: "ROLE_FORBIDDEN", message: "스태프는 그룹 채팅을 생성할 수 없습니다." },
          { status: 403 }
        )
      }

      const groupName = body.name
      const rawMemberIds = body.member_ids
      const memberIdsInput: string[] = Array.isArray(rawMemberIds)
        ? rawMemberIds.filter((x): x is string => typeof x === "string")
        : []
      for (const mid of memberIdsInput) {
        if (!isValidUUID(mid)) {
          return NextResponse.json({ error: "BAD_REQUEST", message: "member_ids must be valid UUIDs." }, { status: 400 })
        }
      }

      const uniqueRequested = Array.from(new Set(memberIdsInput))
        .filter(id => id !== authContext.membership_id)
      let validatedMemberIds: string[] = []
      if (uniqueRequested.length > 0) {
        const { data: verified } = await supabase
          .from("store_memberships")
          .select("id")
          .eq("store_uuid", authContext.store_uuid)
          .eq("status", "approved")
          .is("deleted_at", null)
          .in("id", uniqueRequested)
        const verifiedIds = new Set((verified ?? []).map((m: { id: string }) => m.id))
        if (verifiedIds.size !== uniqueRequested.length) {
          return NextResponse.json(
            { error: "INVALID_MEMBERS", message: "유효하지 않은 멤버가 포함되어 있습니다." },
            { status: 400 }
          )
        }
        validatedMemberIds = [...verifiedIds]
      }

      const { data: created, error: createErr } = await supabase
        .from("chat_rooms")
        .insert({
          store_uuid: authContext.store_uuid,
          type: "group",
          name: groupName?.trim() || "그룹 채팅",
          created_by: authContext.membership_id,
        })
        .select("id")
        .single()

      if (createErr || !created) {
        return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
      }

      const rows = [
        {
          chat_room_id: created.id,
          membership_id: authContext.membership_id,
          store_uuid: authContext.store_uuid,
        },
        ...validatedMemberIds.map(mid => ({
          chat_room_id: created.id,
          membership_id: mid,
          store_uuid: authContext.store_uuid,
        })),
      ]
      await supabase.from("chat_participants").insert(rows)

      return NextResponse.json({ chat_room_id: created.id, type: "group", member_count: rows.length }, { status: 201 })
    }

    // === DIRECT ===
    if (type === "direct") {
      if (!target_membership_id || !isValidUUID(target_membership_id)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "target_membership_id is required for direct type." }, { status: 400 })
      }

      if (target_membership_id === authContext.membership_id) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "자기 자신에게 채팅을 보낼 수 없습니다." }, { status: 400 })
      }

      const { data: targetMembership } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("id", target_membership_id)
        .eq("store_uuid", authContext.store_uuid)
        .eq("status", "approved")
        .maybeSingle()

      if (!targetMembership) {
        return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 })
      }

      // Existing DM deduplication
      const { data: myDirectRooms } = await supabase
        .from("chat_participants")
        .select("chat_room_id")
        .eq("membership_id", authContext.membership_id)
        .eq("store_uuid", authContext.store_uuid)

      let existingRoomId: string | null = null

      if (myDirectRooms && myDirectRooms.length > 0) {
        const myRoomIds = myDirectRooms.map((r: { chat_room_id: string }) => r.chat_room_id)

        const { data: directRooms } = await supabase
          .from("chat_rooms")
          .select("id")
          .in("id", myRoomIds)
          .eq("store_uuid", authContext.store_uuid)
          .eq("type", "direct")

        if (directRooms && directRooms.length > 0) {
          const directRoomIds = directRooms.map((r: { id: string }) => r.id)

          const { data: targetInRoom } = await supabase
            .from("chat_participants")
            .select("chat_room_id")
            .eq("membership_id", target_membership_id)
            .in("chat_room_id", directRoomIds)
            .limit(1)
            .maybeSingle()

          if (targetInRoom) {
            existingRoomId = targetInRoom.chat_room_id
          }
        }
      }

      if (existingRoomId) {
        return NextResponse.json({ chat_room_id: existingRoomId, type: "direct" }, { status: 200 })
      }

      const { data: created, error: createErr } = await supabase
        .from("chat_rooms")
        .insert({
          store_uuid: authContext.store_uuid,
          type: "direct",
          created_by: authContext.membership_id,
        })
        .select("id")
        .single()

      if (createErr || !created) {
        return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
      }

      await supabase
        .from("chat_participants")
        .insert([
          { chat_room_id: created.id, membership_id: authContext.membership_id, store_uuid: authContext.store_uuid },
          { chat_room_id: created.id, membership_id: target_membership_id, store_uuid: authContext.store_uuid },
        ])

      return NextResponse.json({ chat_room_id: created.id, type: "direct" }, { status: 201 })
    }

    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
  } catch (error) {
    return handleRouteError(error, "chat/rooms")
  }
}
