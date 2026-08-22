import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { getRoomList } from "@/lib/chat/services/getRoomList"
import { verifyHostessSessionAccess } from "@/lib/chat/validators/validateRoomAccess"
import { cached, invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

const VALID_TYPES = ["global", "group", "room_session", "direct"] as const

// 2026-05-03 R-Speed-x10: 채팅방 목록 폴링 (10초 간격) 캐시.
const ROOMS_TTL_MS = 5000

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

    // 2026-05-01 R-Hostess-Home: role 전달. staff/hostess 면 global/group 제외.
    // 2026-05-03 R-Speed-x10: TTL 캐시 + 브라우저 max-age=3.
    const cacheKey = `${authContext.store_uuid}:${authContext.membership_id}:${authContext.role}`
    const rooms = await cached(
      "chat_rooms_list",
      cacheKey,
      ROOMS_TTL_MS,
      () => getRoomList(
        supabase,
        authContext.store_uuid,
        authContext.membership_id,
        authContext.role,
      ),
    )

    const res = NextResponse.json({ rooms })
    res.headers.set("Cache-Control", "private, max-age=3, stale-while-revalidate=10")
    return res
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
      /** R-maid-chat (2026-08-23): group type 에서 파싱 자동 인식 활성 · 메이드톡 */
      pattern_enabled?: boolean
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
      // Role gate: global 채팅은 owner / manager 만. staff / waiter / hostess 차단.
      //   - 기존엔 role 체크가 없어 /chat 진입 시 모든 사용자가 auto-join 되었음.
      //   - FE 훅(useChatRooms)도 role-aware 로 보조 변경되지만 서버 측이 단일
      //     진실 공급원 (SSOT). 어떤 경로로 POST 해도 이 가드로 차단.
      const GLOBAL_CHAT_ALLOWED_ROLES = ["owner", "manager"] as const
      if (
        !(GLOBAL_CHAT_ALLOWED_ROLES as readonly string[]).includes(
          authContext.role,
        )
      ) {
        return NextResponse.json(
          {
            error: "ROLE_FORBIDDEN",
            message: "매장 전체 채팅은 사장/실장만 참여 가능합니다.",
          },
          { status: 403 },
        )
      }

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
        .from("rooms").select("name").eq("id", session.room_uuid).eq("store_uuid", authContext.store_uuid).is("deleted_at", null).maybeSingle()

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

      // 2026-06-12 R-cross-store-group: 매장 제약 제거.
      //   기존: store_uuid = authContext.store_uuid 멤버만 허용 → 14매장 협업 시
      //         "INVALID_MEMBERS" 거부. 사장/실장이 다른 매장과 그룹 채팅 불가.
      //   변경: status='approved' + deleted_at IS NULL 만 검증. 어느 매장이든 OK.
      //         각 멤버의 store_uuid 를 그대로 chat_participants 에 보존.
      type MemberRow = { id: string; store_uuid: string }
      let validatedMembers: MemberRow[] = []
      if (uniqueRequested.length > 0) {
        const { data: verified } = await supabase
          .from("store_memberships")
          .select("id, store_uuid")
          .eq("status", "approved")
          .is("deleted_at", null)
          .in("id", uniqueRequested)
        const verifiedRows = (verified ?? []) as MemberRow[]
        if (verifiedRows.length !== uniqueRequested.length) {
          return NextResponse.json(
            { error: "INVALID_MEMBERS", message: "승인되지 않았거나 삭제된 멤버가 포함되어 있습니다." },
            { status: 400 }
          )
        }
        validatedMembers = verifiedRows
      }

      // R-maid-chat (2026-08-23): body.pattern_enabled=true 로 메이드톡 활성 그룹 생성.
      //   기존 group 은 pattern_enabled=false · 일반 채팅. maid mode 는 true.
      const patternEnabled = body.pattern_enabled === true
      const roomInsert: Record<string, unknown> = {
        store_uuid: authContext.store_uuid, // 방의 'home' 매장 = 만든 사람 매장
        type: "group",
        name: groupName?.trim() || (patternEnabled ? "메이드톡" : "그룹 채팅"),
        created_by: authContext.membership_id,
      }
      if (patternEnabled) roomInsert.pattern_enabled = true
      let created
      let createErr
      {
        const r = await supabase.from("chat_rooms").insert(roomInsert).select("id").single()
        created = r.data
        createErr = r.error
        // migration 114 미apply 환경 fallback (pattern_enabled 컬럼 없으면 재시도)
        if (createErr && ((createErr as { code?: string }).code === "42703" || (createErr as { code?: string }).code === "PGRST204")) {
          delete roomInsert.pattern_enabled
          const r2 = await supabase.from("chat_rooms").insert(roomInsert).select("id").single()
          created = r2.data
          createErr = r2.error
        }
      }

      if (createErr || !created) {
        return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 })
      }

      // chat_participants 의 store_uuid 는 각 멤버의 실제 소속 매장
      //   (cross-store 멤버여도 정상)
      const rows = [
        {
          chat_room_id: created.id,
          membership_id: authContext.membership_id,
          store_uuid: authContext.store_uuid,
        },
        ...validatedMembers.map((m) => ({
          chat_room_id: created.id,
          membership_id: m.id,
          store_uuid: m.store_uuid,
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
