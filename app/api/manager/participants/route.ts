import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/manager/participants
 *
 * 실장(manager)이 담당하는 아가씨가 참여 중인 session_participants 조회.
 * origin_store_uuid 기준으로 타매장 세션 포함.
 * match_status (matched/unmatched) 포함.
 * 실장은 자기 담당 participant만 볼 수 있음.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "manager" && authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 현재 실장의 membership_id로 담당하는 active session participants 조회
    // manager_membership_id가 본인인 참여자 (session 단위 배정)
    const { data: participants, error: pError } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, membership_id, external_name, category, time_minutes, origin_store_uuid, entered_at, status, manager_membership_id, role")
      .eq("manager_membership_id", authContext.membership_id)
      .eq("status", "active")
      .eq("role", "hostess")
      .is("deleted_at", null)
      .order("entered_at", { ascending: false })

    if (pError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: pError.message },
        { status: 500 }
      )
    }

    const rows = participants ?? []

    // 2. 매칭 판정: origin_store 아가씨 이름 조회
    // 본인 매장의 hostess 이름 Set
    const { data: storeMemberships } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .is("deleted_at", null)
    const mIds = (storeMemberships ?? []).map((m: { id: string }) => m.id)
    const hostessNames = new Set<string>()
    if (mIds.length > 0) {
      const { data: hsts } = await supabase
        .from("hostesses")
        .select("name, stage_name")
        .in("membership_id", mIds)
      for (const h of hsts ?? []) {
        if (h.name) hostessNames.add(h.name)
        if (h.stage_name) hostessNames.add(h.stage_name)
      }
    }

    // 3. 이름 수정 이력 조회
    const participantIds = rows.map(r => r.id)
    const nameEditedSet = new Set<string>()
    if (participantIds.length > 0) {
      const { data: auditRows } = await supabase
        .from("audit_events")
        .select("entity_id")
        .eq("entity_table", "session_participants")
        .eq("action", "update_external_name")
        .in("entity_id", participantIds)
      for (const a of auditRows ?? []) {
        nameEditedSet.add(a.entity_id)
      }
    }

    // 4. session → room 이름 조회
    const sessionIds = [...new Set(rows.map(r => r.session_id))]
    const sessionRoomMap = new Map<string, { room_name: string; store_name: string }>()
    if (sessionIds.length > 0) {
      const { data: sessions } = await supabase
        .from("room_sessions")
        .select("id, store_uuid, rooms!inner(room_name)")
        .in("id", sessionIds)

      // store_uuid → store_name
      const storeUuids = [...new Set((sessions ?? []).map((s: { store_uuid: string }) => s.store_uuid))]
      const storeNameMap = new Map<string, string>()
      if (storeUuids.length > 0) {
        const { data: stores } = await supabase
          .from("stores")
          .select("id, store_name")
          .in("id", storeUuids)
        for (const s of stores ?? []) storeNameMap.set(s.id, s.store_name)
      }

      for (const s of sessions ?? []) {
        const roomName = Array.isArray(s.rooms) ? (s.rooms as { room_name: string }[])[0]?.room_name : (s.rooms as { room_name: string })?.room_name
        sessionRoomMap.set(s.id, {
          room_name: roomName ?? "?",
          store_name: storeNameMap.get(s.store_uuid) ?? "?",
        })
      }
    }

    // 5. 응답 조립
    const result = rows.map(p => {
      const extName = p.external_name?.trim()
      let matchStatus: "matched" | "unmatched" = "unmatched"
      if (extName && hostessNames.has(extName)) {
        matchStatus = "matched"
      }

      const sessionInfo = sessionRoomMap.get(p.session_id)
      return {
        id: p.id,
        session_id: p.session_id,
        external_name: p.external_name,
        category: p.category,
        time_minutes: p.time_minutes,
        entered_at: p.entered_at,
        origin_store_uuid: p.origin_store_uuid,
        store_uuid: p.store_uuid,
        match_status: matchStatus,
        name_edited: nameEditedSet.has(p.id),
        room_name: sessionInfo?.room_name ?? null,
        working_store_name: sessionInfo?.store_name ?? null,
      }
    })

    return NextResponse.json({ participants: result })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
