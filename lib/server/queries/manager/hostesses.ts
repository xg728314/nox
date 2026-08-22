import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/** R-dispatch-history (2026-07-24): 조판 row 확장 뷰용 오늘 세션 이력. */
export type TodaySessionEntry = {
  participant_id: string
  session_id: string
  store_uuid: string
  store_name: string
  room_no: string | null
  category: string | null
  ticket: string | null
  entered_at: string
  left_at: string | null
  status: string
  time_minutes: number | null
}

export type HostessPreview = {
  hostess_id: string
  hostess_name: string
  // R-mobile (2026-06-01): 스태프동기화 모바일 앱이 필요로 하는 식별자/메타.
  //   기존 클라이언트는 추가 필드를 무시해도 안전 (additive).
  membership_id: string
  profile_id: string | null
  role: string
  status: string
  manager_membership_id: string | null
  origin_store_uuid: string | null
  /** R-cross-store-working (2026-06-24): 어디서든 active session 참여 중. */
  is_working: boolean
  /** 현재 근무 중인 매장 (있으면) */
  working_store_uuid: string | null
  /** R-working-detail (2026-06-25): UI 표시용 세션 상세 */
  working_store_name: string | null
  working_category: string | null
  working_time_minutes: number | null
  /** entered_at — 남은 시간 계산용 (end_at = entered_at + time_minutes) */
  working_entered_at: string | null
  /** R-extend-end (2026-06-25): 일하는 식구의 현재 participant + session ID — 연장/종료 액션용 */
  working_participant_id: string | null
  working_session_id: string | null
  /** R-dispatch-history (2026-07-24) — 조판 프로토타입 매칭 */
  today_session_count?: number
  today_stores?: string[]
  last_left_at?: string | null
  today_sessions?: TodaySessionEntry[]
}

// 프로토타입 매칭: time_minutes + category → 완메/반티/차3/무료 표시명.
function deriveTicket(timeMinutes: number | null, category: string | null): string | null {
  if (!timeMinutes) return null
  if (timeMinutes <= 8) return "무료"
  if (timeMinutes <= 15) return "차3"
  const halfTime = category === "퍼블릭" ? 45 : 30
  if (timeMinutes <= halfTime + 10) return "반티"
  return "완메"
}

/** R-사전등록 (2026-06-08): 아직 NOX 가입 안 된 사전등록 row. */
export type PreRegistrationPreview = {
  pre_registration_id: string
  hostess_name: string
  phone: string
  stage_name: string | null
  note: string | null
  created_at: string
  manager_membership_id: string
  is_pending: true
}

export type ManagerHostessesResponse = {
  store_uuid: string
  role: AuthContext["role"]
  hostesses: HostessPreview[]
  /** 가입 대기 — 실장이 사전등록만 한 사람. /m/staff 에서 "가입 대기" 배지로 표시. */
  pre_registrations: PreRegistrationPreview[]
}

export async function getManagerHostesses(auth: AuthContext): Promise<ManagerHostessesResponse> {
  const supabase = getServiceClient()

  let hostessIds: string[] = []
  // hostess 행에서 가져오는 부가 정보 (manager_membership_id / origin_store_uuid)
  // 를 membership_id 별로 매핑. owner 경로에서는 비어 있을 수 있음.
  const hostessExtras = new Map<string, { manager_membership_id: string | null; origin_store_uuid: string | null }>()

  if (auth.role === "owner") {
    const { data: allHostesses, error: allHostessesError } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")
      // R-owner-soft-delete-filter (2026-08-23): 병합된 hostess 는 deleted_at 스탬프.
      //   owner 경로 필터 누락으로 병합 후에도 목록에 잔존하던 버그 fix.
      .is("deleted_at", null)

    if (allHostessesError) {
      console.error("[getManagerHostesses owner] store_memberships query failed:", allHostessesError)
      throw new Error(`hostess assignments query failed: ${allHostessesError.message}`)
    }
    hostessIds = (allHostesses ?? []).map((hostess) => hostess.id)

    // owner 경로에서도 manager_membership_id / origin_store_uuid 를 추가로 시도.
    // hostesses 테이블이 한 store 의 hostess 행을 갖고 있다면 매핑한다.
    // 2026-06-12: origin_store_uuid 컬럼이 production 일부 환경에 없을 수 있어
    //   42703 (column does not exist) 시 그 컬럼 빼고 재시도.
    if (hostessIds.length > 0) {
      let hRows: unknown[] | null = null
      const full = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id, origin_store_uuid")
        .eq("store_uuid", auth.store_uuid)
        .in("membership_id", hostessIds)
      if (full.error && (full.error as { code?: string }).code === "42703") {
        const base = await supabase
          .from("hostesses")
          .select("membership_id, manager_membership_id")
          .eq("store_uuid", auth.store_uuid)
          .in("membership_id", hostessIds)
        hRows = base.data ?? []
      } else {
        hRows = full.data ?? []
      }
      for (const row of hRows) {
        const r = row as {
          membership_id: string
          manager_membership_id: string | null
          origin_store_uuid?: string | null
        }
        hostessExtras.set(r.membership_id, {
          manager_membership_id: r.manager_membership_id ?? null,
          origin_store_uuid: r.origin_store_uuid ?? null,
        })
      }
    }
  } else {
    // manager 분기 — 같은 fallback
    let assignments: unknown[] | null = null
    const full = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id, origin_store_uuid")
      .eq("store_uuid", auth.store_uuid)
      .eq("manager_membership_id", auth.membership_id)
    if (full.error && (full.error as { code?: string }).code === "42703") {
      const base = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id")
        .eq("store_uuid", auth.store_uuid)
        .eq("manager_membership_id", auth.membership_id)
      if (base.error) {
        console.error("[getManagerHostesses manager] base fallback failed:", base.error)
        throw new Error(`manager assignments fallback failed: ${base.error.message}`)
      }
      assignments = base.data ?? []
    } else if (full.error) {
      console.error("[getManagerHostesses manager] hostesses query failed:", full.error)
      throw new Error(`manager assignments query failed: ${full.error.message}`)
    } else {
      assignments = full.data ?? []
    }
    for (const row of assignments ?? []) {
      const r = row as { membership_id: string; manager_membership_id: string | null; origin_store_uuid?: string | null }
      hostessIds.push(r.membership_id)
      hostessExtras.set(r.membership_id, {
        manager_membership_id: r.manager_membership_id ?? null,
        origin_store_uuid: r.origin_store_uuid ?? null,
      })
    }
  }

  // 사전등록 조회 — owner 는 매장 전체, manager 는 본인 등록만
  const preRegistrations = await loadPreRegistrations(supabase, auth)

  if (hostessIds.length === 0) {
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      hostesses: [],
      pre_registrations: preRegistrations,
    }
  }

  const { data: hostesses, error: hostessesError } = await supabase
    .from("store_memberships")
    .select("id, profile_id, role, status, profiles!store_memberships_profile_id_fkey(full_name)")
    .eq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .in("id", hostessIds)

  if (hostessesError) {
    console.error("[getManagerHostesses] store_memberships details query failed:", hostessesError)
    throw new Error(`hostess details query failed: ${hostessesError.message}`)
  }

  // R-cross-store-working: 현재 active session 참여 중 hostess 추출.
  //   session_participants (status='active') JOIN room_sessions (status='active')
  //   타매장 dispatch 로 다른 매장에서 일하는 식구도 잡힘.
  //   R-working-detail (2026-06-25): 세션 상세 (category, time_minutes,
  //   entered_at) 도 같이 가져옴 → UI 에서 \"남은 시간\" 계산.
  type WorkInfo = {
    store_uuid: string
    category: string | null
    time_minutes: number | null
    entered_at: string | null
    participant_id: string
    session_id: string
    /** R-room-no-display (2026-07-24): 프로토타입 조판 "지금 · 라이브1" 매칭 */
    room_uuid: string | null
    room_no: string | null
  }
  const workingMap = new Map<string, WorkInfo>()
  const workingStoreUuids = new Set<string>()
  const workingRoomUuids = new Set<string>()
  // R-dispatch-history: 이력 lookup 에서도 재사용 위해 hoist.
  const storeNameMap = new Map<string, string>()
  // R-room-no-display (2026-07-24): 방번호 lookup.
  const roomNoMap = new Map<string, string>()
  {
    const { data: parts } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, store_uuid, category, time_minutes, entered_at, room_sessions!inner(status, room_uuid)")
      .in("membership_id", hostessIds)
      .eq("status", "active")
      .is("deleted_at", null)
    type PartRow = {
      id: string
      session_id: string
      membership_id: string
      store_uuid: string
      category: string | null
      time_minutes: number | null
      entered_at: string | null
      room_sessions: { status: string; room_uuid: string | null } | { status: string; room_uuid: string | null }[] | null
    }
    for (const p of ((parts ?? []) as PartRow[])) {
      const sess = Array.isArray(p.room_sessions) ? p.room_sessions[0] : p.room_sessions
      if (sess?.status === "active" && !workingMap.has(p.membership_id)) {
        workingMap.set(p.membership_id, {
          store_uuid: p.store_uuid,
          category: p.category,
          time_minutes: p.time_minutes,
          entered_at: p.entered_at,
          participant_id: p.id,
          session_id: p.session_id,
          room_uuid: sess.room_uuid ?? null,
          room_no: null,
        })
        workingStoreUuids.add(p.store_uuid)
        if (sess.room_uuid) workingRoomUuids.add(sess.room_uuid)
      }
    }
  }

  // R-room-no-display: room_no lookup + workingMap 에 재주입.
  if (workingRoomUuids.size > 0) {
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_no")
      .in("id", Array.from(workingRoomUuids))
    for (const r of ((rooms ?? []) as { id: string; room_no: string }[])) {
      roomNoMap.set(r.id, r.room_no)
    }
    for (const [membershipId, info] of workingMap.entries()) {
      if (info.room_uuid) {
        info.room_no = roomNoMap.get(info.room_uuid) ?? null
        workingMap.set(membershipId, info)
      }
    }
  }

  // R-dispatch-history (2026-07-24): 오늘 세션 이력 (조판 확장 뷰용).
  //   - 지난 24h 참여한 모든 세션 (status 무관)
  //   - hostess 별: today_session_count, today_stores, last_left_at, today_sessions[]
  //   - 카드 확장 시 rendering
  type TodaySession = {
    participant_id: string
    session_id: string
    store_uuid: string
    store_name: string
    room_no: string | null
    category: string | null
    ticket: string | null
    entered_at: string
    left_at: string | null
    status: string
    time_minutes: number | null
  }
  const historyMap = new Map<string, {
    sessions: TodaySession[]
    stores: Set<string>
    last_left_at: string | null
  }>()
  if (hostessIds.length > 0) {
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: historyParts } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, store_uuid, category, time_minutes, entered_at, left_at, status, room_sessions!inner(room_uuid)")
      .in("membership_id", hostessIds)
      .gte("entered_at", dayAgoIso)
      .is("deleted_at", null)
      .order("entered_at", { ascending: true })
    type HistoryRow = {
      id: string
      session_id: string
      membership_id: string
      store_uuid: string
      category: string | null
      time_minutes: number | null
      entered_at: string
      left_at: string | null
      status: string
      room_sessions: { room_uuid: string } | { room_uuid: string }[] | null
    }
    const rows = ((historyParts ?? []) as HistoryRow[])
    // room 조회 (room_uuid → room_no)
    const roomUuids = new Set<string>()
    for (const r of rows) {
      const sess = Array.isArray(r.room_sessions) ? r.room_sessions[0] : r.room_sessions
      if (sess?.room_uuid) roomUuids.add(sess.room_uuid)
    }
    const roomNoByUuid = new Map<string, string>()
    if (roomUuids.size > 0) {
      const { data: roomRows } = await supabase
        .from("rooms")
        .select("id, room_no")
        .in("id", Array.from(roomUuids))
      for (const r of ((roomRows ?? []) as { id: string; room_no: string }[])) {
        roomNoByUuid.set(r.id, r.room_no)
      }
    }
    // 이력 store name lookup
    const historyStoreIds = new Set<string>()
    for (const r of rows) historyStoreIds.add(r.store_uuid)
    if (historyStoreIds.size > 0) {
      const { data: sRows } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", Array.from(historyStoreIds))
      for (const s of ((sRows ?? []) as { id: string; store_name: string }[])) {
        if (!storeNameMap.has(s.id)) storeNameMap.set(s.id, s.store_name)
      }
    }
    for (const r of rows) {
      const sess = Array.isArray(r.room_sessions) ? r.room_sessions[0] : r.room_sessions
      const storeName = storeNameMap.get(r.store_uuid) ?? ""
      const roomNo = sess?.room_uuid ? (roomNoByUuid.get(sess.room_uuid) ?? null) : null
      const ticket = deriveTicket(r.time_minutes, r.category)
      const entry: TodaySession = {
        participant_id: r.id,
        session_id: r.session_id,
        store_uuid: r.store_uuid,
        store_name: storeName,
        room_no: roomNo,
        category: r.category,
        ticket,
        entered_at: r.entered_at,
        left_at: r.left_at,
        status: r.status,
        time_minutes: r.time_minutes,
      }
      const bucket = historyMap.get(r.membership_id) ?? {
        sessions: [],
        stores: new Set<string>(),
        last_left_at: null,
      }
      bucket.sessions.push(entry)
      if (storeName) bucket.stores.add(storeName)
      if (r.left_at && (!bucket.last_left_at || r.left_at > bucket.last_left_at)) {
        bucket.last_left_at = r.left_at
      }
      historyMap.set(r.membership_id, bucket)
    }
  }

  // working store 이름 매핑 (id → store_name) — storeNameMap 는 hoist 됨
  if (workingStoreUuids.size > 0) {
    const { data: storeRows } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", Array.from(workingStoreUuids))
    for (const s of ((storeRows ?? []) as { id: string; store_name: string }[])) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  type ProfileEmbed = { full_name: string | null } | { full_name: string | null }[] | null
  type Row = {
    id: string
    profile_id: string | null
    role: string
    status: string
    profiles: ProfileEmbed
  }
  // PostgREST 는 FK embed 를 단일 객체로 반환 (1:1 관계). 과거 코드가 `[0]` 로
  // 접근해서 항상 빈 문자열 → 스태프 이름이 "?" 로 표시되던 버그 fix.
  const pickFullName = (p: ProfileEmbed): string => {
    if (!p) return ""
    if (Array.isArray(p)) return p[0]?.full_name ?? ""
    return p.full_name ?? ""
  }

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    hostesses: (hostesses ?? []).map((h: Row) => {
      const extras = hostessExtras.get(h.id) ?? { manager_membership_id: null, origin_store_uuid: null }
      const workInfo = workingMap.get(h.id) ?? null
      const history = historyMap.get(h.id)
      return {
        hostess_id: h.id,
        hostess_name: pickFullName(h.profiles),
        membership_id: h.id,
        profile_id: h.profile_id ?? null,
        role: h.role,
        status: h.status,
        manager_membership_id: extras.manager_membership_id,
        origin_store_uuid: extras.origin_store_uuid,
        is_working: workInfo !== null,
        working_store_uuid: workInfo?.store_uuid ?? null,
        working_store_name: workInfo ? (storeNameMap.get(workInfo.store_uuid) ?? null) : null,
        working_category: workInfo?.category ?? null,
        working_time_minutes: workInfo?.time_minutes ?? null,
        working_entered_at: workInfo?.entered_at ?? null,
        working_participant_id: workInfo?.participant_id ?? null,
        working_session_id: workInfo?.session_id ?? null,
        // R-dispatch-history — 프로토타입 매칭
        today_session_count: history?.sessions.length ?? 0,
        today_stores: history ? Array.from(history.stores) : [],
        last_left_at: history?.last_left_at ?? null,
        today_sessions: history?.sessions ?? [],
      }
    }),
    pre_registrations: preRegistrations,
  }
}

/**
 * 사전등록 row 조회.
 *
 * - manager: 본인이 등록한 active 사전등록만
 * - owner: 매장 전체 active 사전등록
 *
 * 테이블 미적용 (migration 111 미실행) 시 빈 배열로 graceful fallback.
 */
async function loadPreRegistrations(
  supabase: ReturnType<typeof getServiceClient>,
  auth: AuthContext,
): Promise<PreRegistrationPreview[]> {
  let query = supabase
    .from("hostess_pre_registrations")
    .select("id, name, phone, stage_name, note, created_at, manager_membership_id")
    .eq("store_uuid", auth.store_uuid)
    .is("deleted_at", null)
    .is("linked_membership_id", null) // 가입 완료된 것은 hostesses 에서 이미 보임
    .order("created_at", { ascending: false })

  if (auth.role === "manager") {
    query = query.eq("manager_membership_id", auth.membership_id)
  }

  const { data, error } = await query
  if (error) {
    // 42P01: 테이블 없음 (migration 미적용) — 조용히 빈 배열
    if ((error as { code?: string }).code === "42P01") return []
    // 그 외 에러는 로그 + 빈 배열 (hostesses 응답을 막지 않음)
    console.warn("[loadPreRegistrations] error:", error)
    return []
  }
  type Row = {
    id: string
    name: string
    phone: string
    stage_name: string | null
    note: string | null
    created_at: string
    manager_membership_id: string
  }
  return ((data ?? []) as Row[]).map((r) => ({
    pre_registration_id: r.id,
    hostess_name: r.name,
    phone: r.phone,
    stage_name: r.stage_name,
    note: r.note,
    created_at: r.created_at,
    manager_membership_id: r.manager_membership_id,
    is_pending: true as const,
  }))
}
