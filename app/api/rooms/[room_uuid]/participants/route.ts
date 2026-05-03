import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveMatchStatus } from "@/lib/session/matching"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: rooms/monitor 와 동일하게 TTL 캐시 + SWR.
//   카운터 화면이 focus 변경 시 매번 fetch. 같은 (room, session) 의 polling
//   사이클은 5s 안 거의 변화 없음. 캐시 hit 시 ~5ms.
const PARTICIPANTS_TTL_MS = 3000

// cached() callback 안에서 throw 해서 outer catch 가 status 응답 생성.
class ParticipantsRouteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = "ParticipantsRouteError"
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ room_uuid: string }> }
) {
  try {
    const { room_uuid: roomUuidParam } = await params
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const roomUuid = roomUuidParam
    if (!roomUuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "room_uuid is required." },
        { status: 400 }
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

    // 캐시 key: store + room (+ role for visibility 분기). session_id 가 바뀌면
    //   자연스럽게 다른 응답 — TTL 안에선 같은 응답 재사용 OK.
    const cacheKey = `${authContext.store_uuid}:${roomUuid}:${authContext.role}`
    const cachedData = await cached(
      "room_participants",
      cacheKey,
      PARTICIPANTS_TTL_MS,
      () => buildParticipantsResponse(supabase, roomUuid, authContext),
    )
    const res = NextResponse.json(cachedData)
    // 브라우저도 2초 cache + 5초 SWR — focus 빠른 재진입 시 즉시 표시.
    res.headers.set("Cache-Control", "private, max-age=2, stale-while-revalidate=5")
    return res
  } catch (error) {
    if (error instanceof ParticipantsRouteError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      )
    }
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// 2026-05-03 R-Speed-x10: GET 본문을 함수로 추출 — cached() callback 호환.
async function buildParticipantsResponse(
  supabase: SupabaseClient,
  roomUuid: string,
  authContext: Awaited<ReturnType<typeof resolveAuthContext>>,
): Promise<Record<string, unknown>> {
  {

    // 1. Verify room exists in this store
    // 2026-05-01 R-Counter-Speed: room 검증 + active session 병렬 fetch.
    //   둘 다 store_uuid + roomUuid 만 의존 (상호 무관). 직렬 → Promise.all.
    const [roomRes, sessionRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("id", roomUuid)
        .maybeSingle(),
      supabase
        .from("room_sessions")
        .select("id, status, started_at, ended_at")
        .eq("store_uuid", authContext.store_uuid)
        .eq("room_uuid", roomUuid)
        .eq("status", "active")
        .maybeSingle(),
    ])
    const room = roomRes.data
    const session = sessionRes.data

    if (!room) {
      throw new ParticipantsRouteError(404, "ROOM_NOT_FOUND", "Room not found in this store.")
    }

    // No active session = no participants (not an error)
    if (!session) {
      return {
        room_uuid: roomUuid,
        store_uuid: authContext.store_uuid,
        session_id: null,
        session_status: null,
        session_started_at: null,
        session_ended_at: null,
        participants: [],
      }
    }

    // 3. Get participants for the active session (scoped by store_uuid)
    // `name_edited_at` (migration 058) replaces the audit_events scan
    // previously used to compute the name_edited badge. No extra
    // round-trip needed.
    const { data: participants, error: participantsError } = await supabase
      .from("session_participants")
      .select("id, role, status, membership_id, external_name, category, time_minutes, price_amount, cha3_amount, banti_amount, waiter_tip_received, waiter_tip_amount, origin_store_uuid, entered_at, left_at, memo, manager_membership_id, name_edited_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("session_id", session.id)
      .order("entered_at", { ascending: true })

    if (participantsError) {
      throw new ParticipantsRouteError(500, "QUERY_FAILED", "Failed to query participants.")
    }

    // 4. Lookup names + 담당실장 from managers/hostesses tables by membership_id
    const membershipIds = (participants ?? [])
      .map((p: { membership_id: string }) => p.membership_id)
      .filter((id): id is string => !!id)
    const nameMap = new Map<string, string>()
    const managerMap = new Map<string, { manager_membership_id: string | null }>()

    // 매칭 판정용: origin_store 기준 스태프 이름 Set (매장별로 캐시)
    const relevantStoreUuids = [...new Set([
      authContext.store_uuid,
      ...(participants ?? [])
        .map((p: { origin_store_uuid: string | null }) => p.origin_store_uuid)
        .filter((id): id is string => !!id),
    ])]
    const hostessNameSetByStore = new Map<string, Set<string>>()
    const storeNameById = new Map<string, string>()
    const managerNameMap = new Map<string, string>()

    // 2026-05-01 R-Counter-Speed v2: 1차 Wave — participant 정보만 의존하는 4 query
    //   동시 fire (managers, hostesses, store_memberships, stores).
    //   기존 직렬 4 wave → 1 wave.
    const [mgrsRes, hstsRes, storeMembersRes, storesDataRes] = await Promise.all([
      membershipIds.length > 0
        ? supabase
            .from("managers")
            .select("membership_id, name")
            .in("membership_id", membershipIds)
        : Promise.resolve({ data: [] as Array<{ membership_id: string; name: string }> }),
      membershipIds.length > 0
        ? supabase
            .from("hostesses")
            .select("membership_id, name, manager_membership_id")
            .in("membership_id", membershipIds)
        : Promise.resolve({ data: [] as Array<{ membership_id: string; name: string; manager_membership_id: string | null }> }),
      relevantStoreUuids.length > 0
        ? supabase
            .from("store_memberships")
            .select("id, store_uuid")
            .in("store_uuid", relevantStoreUuids)
            .eq("role", "hostess")
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Array<{ id: string; store_uuid: string }> }),
      relevantStoreUuids.length > 0
        ? supabase
            .from("stores")
            .select("id, store_name")
            .in("id", relevantStoreUuids)
        : Promise.resolve({ data: [] as Array<{ id: string; store_name: string }> }),
    ])

    for (const m of mgrsRes.data ?? []) nameMap.set(m.membership_id, m.name)
    for (const h of hstsRes.data ?? []) {
      nameMap.set(h.membership_id, h.name)
      managerMap.set(h.membership_id, { manager_membership_id: h.manager_membership_id ?? null })
    }
    for (const s of storesDataRes.data ?? []) storeNameById.set(s.id, s.store_name)

    // 담당실장 이름 조회 — session 단위 + hostesses fallback 모두 수집
    const sessionManagerIds = (participants ?? [])
      .map((p: { manager_membership_id: string | null }) => p.manager_membership_id)
      .filter((id): id is string => !!id)
    const hostessManagerIds = [...managerMap.values()]
      .map(v => v.manager_membership_id)
      .filter((id): id is string => !!id)
    const allManagerIds = [...new Set([...sessionManagerIds, ...hostessManagerIds])]

    const storeMembers = storeMembersRes.data ?? []
    const membersByStore = new Map<string, string[]>()
    for (const sm of storeMembers) {
      const arr = membersByStore.get(sm.store_uuid) ?? []
      arr.push(sm.id)
      membersByStore.set(sm.store_uuid, arr)
    }
    const allMemberIds = storeMembers.map((sm) => sm.id)

    // 2026-05-01 R-Counter-Speed v2: 2차 Wave — 1차 결과에 의존하는 2 query 동시 fire
    //   (managers for names, hostesses for name set). 기존 직렬 2 wave → 1 wave.
    const [mgrNamesRes, allHRes] = await Promise.all([
      allManagerIds.length > 0
        ? supabase
            .from("managers")
            .select("membership_id, name")
            .in("membership_id", allManagerIds)
        : Promise.resolve({ data: [] as Array<{ membership_id: string; name: string }> }),
      allMemberIds.length > 0
        ? supabase
            .from("hostesses")
            .select("membership_id, name, stage_name")
            .in("membership_id", allMemberIds)
        : Promise.resolve({ data: [] as Array<{ membership_id: string; name: string | null; stage_name: string | null }> }),
    ])

    for (const m of mgrNamesRes.data ?? []) managerNameMap.set(m.membership_id, m.name)

    // membership_id → store_uuid 역매핑
    const memberToStore = new Map<string, string>()
    for (const [storeUuid, mids] of membersByStore) {
      for (const mid of mids) memberToStore.set(mid, storeUuid)
    }
    for (const h of allHRes.data ?? []) {
      const sUuid = memberToStore.get(h.membership_id)
      if (!sUuid) continue
      if (!hostessNameSetByStore.has(sUuid)) hostessNameSetByStore.set(sUuid, new Set())
      const nameSet = hostessNameSetByStore.get(sUuid)!
      if (h.name) nameSet.add(h.name)
      if (h.stage_name) nameSet.add(h.stage_name)
    }

    // 6. 이름 수정 이력은 session_participants.name_edited_at 컬럼에서
    //    직접 파생 (migration 058). 이전 audit_events 스캔은 제거 —
    //    store_uuid 필터/시간 윈도우 없는 full-table 스캔이었고,
    //    skill-01 (store_uuid 스코프) 위반 상태였다. audit_events 는
    //    여전히 이력 소스이나 hot read 경로에서 호출하지 않는다.

    const participantsWithNames = (participants ?? []).map((p: { id: string; role: string; status: string; membership_id: string; external_name: string | null; category: string | null; time_minutes: number | null; price_amount: number | null; cha3_amount: number | null; banti_amount: number | null; waiter_tip_received: boolean | null; waiter_tip_amount: number | null; origin_store_uuid: string | null; entered_at: string; left_at: string | null; memo: string | null; manager_membership_id: string | null; name_edited_at: string | null }) => {
      // 우선순위: session 단위 → hostesses 기본 담당
      const sessionMgrId = p.manager_membership_id
      const hostessMgrId = managerMap.get(p.membership_id)?.manager_membership_id ?? null
      const resolvedMgrId = sessionMgrId ?? hostessMgrId
      const managerName = resolvedMgrId ? (managerNameMap.get(resolvedMgrId) ?? null) : null

      // 매칭 판정: origin_store 기준 (없으면 working store)
      // exact match → "matched", 유사 이름 → "review_needed", 없음 → "unmatched"
      const matchStoreUuid = p.origin_store_uuid ?? authContext.store_uuid
      const hostessNameSet = hostessNameSetByStore.get(matchStoreUuid) ?? new Set()
      const extName = p.external_name?.trim()
      const resolvedName = nameMap.get(p.membership_id) || null
      let matchStatus: "matched" | "review_needed" | "unmatched" | null = null
      let matchCandidates: string[] = []
      if (p.role === "hostess" && p.category) {
        // 1차: external_name으로 판정
        const extResult = resolveMatchStatus(extName ?? null, hostessNameSet)
        if (extResult.status === "matched") {
          matchStatus = "matched"
        } else {
          // 2차: resolved name (membership 기반) fallback
          const resolvedResult = resolveMatchStatus(resolvedName, hostessNameSet)
          if (resolvedResult.status === "matched") {
            matchStatus = "matched"
          } else {
            // 둘 다 exact 실패 — external_name 기준 유사 판정 사용
            matchStatus = extResult.status !== "unmatched" ? extResult.status : resolvedResult.status
            matchCandidates = extResult.candidates.length > 0 ? extResult.candidates : resolvedResult.candidates
            // 이름 자체가 없으면 unmatched
            if (!extName && !resolvedName) {
              matchStatus = "unmatched"
              matchCandidates = []
            }
          }
        }
      }

      return {
        ...p,
        name: resolvedName,
        manager_membership_id: resolvedMgrId,
        manager_name: managerName,
        match_status: matchStatus,
        match_candidates: matchCandidates.length > 0 ? matchCandidates : undefined,
        name_edited: p.name_edited_at !== null,
        origin_store_name: p.origin_store_uuid ? (storeNameById.get(p.origin_store_uuid) ?? null) : null,
      }
    })

    return {
      room_uuid: roomUuid,
      store_uuid: authContext.store_uuid,
      session_id: session.id,
      session_status: session.status,
      session_started_at: session.started_at,
      session_ended_at: session.ended_at,
      participants: participantsWithNames,
    }
  }
}
