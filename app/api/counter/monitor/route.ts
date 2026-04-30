import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import {
  computePresenceConfidence,
  buildConfidenceContextByMember,
  type CorrectionHistoryRow,
} from "@/lib/ble/computePresenceConfidence"
import { defaultRoomName } from "@/lib/rooms/formatRoomLabel"
import { archivedAtFilter } from "@/lib/session/archivedFilter"
import { cached } from "@/lib/cache/inMemoryTtl"

// R29-perf: 가장 무거운 endpoint. 380명 × 5초 폴링 = ~76 req/s.
//   3초 TTL → DB 직격 50% 감소 (서버 인스턴스마다).
//   stale-while-revalidate 로 클라 측에도 공유.
const MONITOR_TTL_MS = 3000

class MonitorQueryError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "MonitorQueryError" }
}

/**
 * GET /api/counter/monitor
 *
 * Counter Monitoring V2 read endpoint. Returns a policy-safe, DERIVED
 * snapshot of the caller's store. Read-only. Never writes business state.
 *
 * Visibility policy encoded here (MUST match UI):
 *   - Current-store workers  : active session participants in the caller's
 *                              store. Anyone with membership.store_uuid =
 *                              auth.store_uuid is a "current-store worker"
 *                              for display.
 *   - Home-store workers     : hostesses registered under auth.store_uuid
 *                              (the caller's owners/managers can see their
 *                              own store's hostess roster + whether each
 *                              is currently working anywhere). For hostesses
 *                              working at ANOTHER store right now, we derive
 *                              that fact via cross_store_work_records where
 *                              origin_store_uuid = auth.store_uuid.
 *   - Foreign-store workers  : visible ONLY while they are an active
 *                              participant (session_participants.status =
 *                              'active') of an active session
 *                              (room_sessions.status = 'active') IN THE
 *                              CALLER'S store. Their membership.store_uuid
 *                              must differ from auth.store_uuid. As soon
 *                              as the session or their participation ends,
 *                              this endpoint drops them — the UI receives
 *                              no stale foreign-worker rows.
 *
 * BLE policy:
 *   - This endpoint NEVER reads from `ble_tag_presence` / `ble_ingest_events`
 *     as a trust source. Presence/zone is derived from the manual session
 *     record only.
 *   - A future BLE overlay can be added non-invasively by reading presence
 *     into a separate `ble_zones` block on the same response shape, with a
 *     dedicated confidence field. Settlement/session writes must never
 *     depend on it (task rule 14).
 *
 * Zone derivation (current implementation, BLE-free):
 *   - active participant in active session → zone: "room:<room_uuid>"     → 재실
 *   - session_participants.status = "mid_out" (active session)            → 이탈
 *   - 화장실 / 외부(타층) : no data today, returned as 0 with BLE marker.
 *   - 대기: home-store hostesses not currently in any active session.
 */

type Row = Record<string, unknown>

// ── Server-derived recommendation facts ────────────────────────────
// Raw numbers the client can filter by user alert prefs. NO state
// mutation and NO business impact. Baselines below are small sanity
// floors so we don't flood the payload — client prefs apply a higher
// floor on top.
type RecCode = "long_mid_out" | "long_session" | "overdue" | "extension_reminder"
type Rec = { code: RecCode; minutes?: number; message: string }

const SERVER_LONG_MID_OUT_FLOOR = 5     // minutes (baseline emit threshold)
const SERVER_LONG_SESSION_FLOOR = 60    // minutes

function deriveRecommendations(input: {
  status: string
  entered_at: string
  left_at: string | null
  time_minutes: number
  operator_status: "normal" | "still_working" | "ended" | "extended"
  extension_count: number
  latest_action_id: string | null
  last_applied_action_id: string | null
  nowMs: number
}): Rec[] {
  const out: Rec[] = []
  const { status, entered_at, left_at, time_minutes, nowMs } = input

  // long_mid_out — use left_at as the mid-out anchor if available; else
  // entered_at as the safe fallback.
  if (status === "mid_out" || status === "left") {
    const baseIso = left_at || entered_at
    const baseMs = new Date(baseIso).getTime()
    if (Number.isFinite(baseMs)) {
      const mins = Math.max(0, Math.floor((nowMs - baseMs) / 60_000))
      if (mins >= SERVER_LONG_MID_OUT_FLOOR) {
        out.push({ code: "long_mid_out", minutes: mins, message: `자리비움 ${mins}분` })
      }
    }
  }

  // long_session — elapsed since entered_at for active participants.
  if (status === "active") {
    const enteredMs = new Date(entered_at).getTime()
    if (Number.isFinite(enteredMs)) {
      const mins = Math.max(0, Math.floor((nowMs - enteredMs) / 60_000))
      if (mins >= SERVER_LONG_SESSION_FLOOR) {
        out.push({ code: "long_session", minutes: mins, message: `경과 ${mins}분` })
      }
      // overdue — active participant whose booked time_minutes has elapsed.
      if (time_minutes > 0) {
        const overdue = mins - time_minutes
        if (overdue > 0) {
          out.push({ code: "overdue", minutes: overdue, message: `예상 종료 초과 ${overdue}분` })
        }
      }
    }
  }

  // extension_reminder — operator recorded an extension but hasn't
  // applied yet (latest action != last applied cursor). Categorical.
  if (input.operator_status === "extended"
      && input.latest_action_id
      && input.latest_action_id !== input.last_applied_action_id) {
    out.push({ code: "extension_reminder", message: `연장 ${input.extension_count}회 적용 대기` })
  }

  return out
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    // Policy: monitoring data is owner / manager only. Waiter/staff still
    // use the transactional counter page; they do not need cross-room
    // visibility.
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Monitoring requires owner/manager role." },
        { status: 403 }
      )
    }

    // R29-perf: TTL 캐시. 본문 전체를 cached 안에 넣어 DB 호출 회수 감소.
    //   query string 의 mode=hybrid 같은 변형이 있으면 cache key 분리.
    const url = new URL(request.url)
    const queryParam = url.searchParams.toString()
    const cacheKey = `${auth.store_uuid}:${auth.role}:${queryParam}`

    const cachedData = await cached(
      "monitor",
      cacheKey,
      MONITOR_TTL_MS,
      async () => {
        return await buildMonitorResponse(request, auth)
      },
    )
    const res = NextResponse.json(cachedData)
    res.headers.set("Cache-Control", "private, max-age=1, stale-while-revalidate=2")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    if (error instanceof MonitorQueryError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// R29-perf: 기존 GET 본문을 별도 함수로 추출 — 캐시 callback 에서 호출.
async function buildMonitorResponse(
  request: Request,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
): Promise<Record<string, unknown>> {
  {
    const supabase = supa()
    const storeUuid = auth.store_uuid
    // Single "now" captured once per request so per-participant
    // recommendation minutes are consistent across rooms.
    const monitorNowMs = Date.now()

    // 2026-04-30 R-Perf: Wave 1A — 3개 독립 쿼리 병렬 fetch.
    //   selfStoreRow / roomsData / sessData 모두 storeUuid 만 의존, 상호 무관.
    //   기존 직렬 await 3회 → Promise.all 1회 (latency 최대 3분의 1).
    //   archivedAtFilter 는 sessData 만 wrap 필요 — 미리 await.
    const applyArchivedNull = await archivedAtFilter(supabase)
    const [selfStoreRes, roomsRes, sessRes] = await Promise.all([
      supabase
        .from("stores")
        .select("store_name")
        .eq("id", storeUuid)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("id, room_no, room_name, floor_no, sort_order, is_active")
        .eq("store_uuid", storeUuid)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      applyArchivedNull(
        supabase
          .from("room_sessions")
          .select(
            "id, room_uuid, status, started_at, manager_name, manager_membership_id, customer_name_snapshot, customer_party_size",
          )
          .eq("store_uuid", storeUuid)
          .eq("status", "active")
          .is("deleted_at", null)
      ),
    ])

    const { data: selfStoreRow } = selfStoreRes
    const selfStoreName: string | null =
      (selfStoreRow?.store_name as string | null) ?? null

    const { data: roomsData, error: roomsErr } = roomsRes
    if (roomsErr) {
      throw new MonitorQueryError("QUERY_FAILED", roomsErr.message)
    }

    const rooms =
      (roomsData ?? []).map((r: Row) => {
        const room_no = String(r.room_no ?? "")
        const raw_name = (r.room_name as string | null) ?? null
        return {
          room_uuid: String(r.id),
          room_no,
          room_name: raw_name && raw_name.trim().length > 0 ? raw_name : defaultRoomName(room_no),
          floor_no: (r.floor_no as number | null) ?? null,
          sort_order: (r.sort_order as number | null) ?? 0,
          is_active: Boolean(r.is_active),
        }
      })

    const { data: sessData, error: sessErr } = sessRes
    if (sessErr) {
      throw new MonitorQueryError("QUERY_FAILED", sessErr.message)
    }

    const activeSessions = (sessData ?? []) as Array<{
      id: string
      room_uuid: string
      status: string
      started_at: string
      manager_name: string | null
      manager_membership_id: string | null
      customer_name_snapshot: string | null
      customer_party_size: number | null
    }>
    const activeSessionIds = activeSessions.map(s => s.id)
    const sessionByRoom = new Map<string, typeof activeSessions[number]>()
    for (const s of activeSessions) sessionByRoom.set(s.room_uuid, s)

    // ── Participants of those active sessions ────────────────────────
    let participants: Array<{
      id: string
      session_id: string
      membership_id: string | null
      role: string
      category: string | null
      status: string
      entered_at: string
      left_at: string | null
      time_minutes: number
      origin_store_uuid: string | null
      memo: string | null
      last_applied_action_id: string | null
    }> = []
    if (activeSessionIds.length > 0) {
      const { data: pData, error: pErr } = await supabase
        .from("session_participants")
        .select(
          "id, session_id, membership_id, role, category, status, entered_at, left_at, time_minutes, origin_store_uuid, memo, last_applied_action_id",
        )
        .in("session_id", activeSessionIds)
        .is("deleted_at", null)
      if (pErr) {
        throw new MonitorQueryError("QUERY_FAILED", pErr.message)
      }
      participants = (pData ?? []) as typeof participants
    }

    // ── Operator action overlay (human decisions) ──────────────────
    // Fetch the LATEST session_participant_actions row per participant
    // in a single query. The derived operator_status drives:
    //   - hiding `ended` participants from the monitor snapshot
    //   - badging `extended` participants (extension_count)
    //   - muting absence alerts for `still_working`
    //
    // Source-of-truth for business state remains /counter — this layer
    // never drives settlement or time_segments.
    type OpStatus = "normal" | "still_working" | "ended" | "extended"
    const operatorStatusById = new Map<string, {
      status: OpStatus
      extension_count: number
      latest_action_id: string
    }>()
    if (participants.length > 0) {
      const pIds = participants.map(p => p.id)
      const { data: actionRows } = await supabase
        .from("session_participant_actions")
        .select("id, participant_id, action_type, extension_count, acted_at")
        .eq("store_uuid", storeUuid)
        .in("participant_id", pIds)
        .order("acted_at", { ascending: false })
      for (const r of (actionRows ?? []) as Array<{
        id: string
        participant_id: string
        action_type: string
        extension_count: number | null
        acted_at: string
      }>) {
        if (operatorStatusById.has(r.participant_id)) continue // keep latest only
        const status: OpStatus =
          r.action_type === "still_working" ? "still_working" :
          r.action_type === "end_now" ? "ended" :
          r.action_type === "extend" ? "extended" :
          "normal"
        const extension_count =
          r.action_type === "extend" ? (r.extension_count ?? 0) : 0
        operatorStatusById.set(r.participant_id, {
          status,
          extension_count,
          latest_action_id: r.id,
        })
      }
    }

    // ── Apply-state overlay (apply_status per LATEST action) ───────
    // For every participant whose latest action_id is known, join the
    // `session_participant_action_applies` row so the UI can distinguish
    // "recorded only" (pending) vs "actually reflected" (success) vs
    // "failed". This drives the ApplyStatusBadge on the counter monitor
    // and the retry CTA in ActionPopover. Server is the single source
    // of truth — the client never infers these from other fields.
    type ApplyRowLite = {
      action_id: string
      apply_status: "pending" | "success" | "failed"
      attempt_count: number
      last_attempted_at: string | null
      failure_code: string | null
      failure_message: string | null
    }
    const applyByActionId = new Map<string, ApplyRowLite>()
    const latestActionIds: string[] = []
    for (const v of operatorStatusById.values()) {
      if (v.latest_action_id) latestActionIds.push(v.latest_action_id)
    }
    if (latestActionIds.length > 0) {
      const { data: applyRows } = await supabase
        .from("session_participant_action_applies")
        .select("action_id, apply_status, attempt_count, last_attempted_at, failure_code, failure_message")
        .in("action_id", latestActionIds)
      for (const r of (applyRows ?? []) as ApplyRowLite[]) {
        applyByActionId.set(r.action_id, r)
      }
    }

    // Hide `ended` participants from EVERY downstream derivation
    // (summary counts, room shape, home/foreign worker lists). The row
    // stays in the DB for audit and for /counter to finalize; the
    // monitor just stops showing it.
    participants = participants.filter(
      p => operatorStatusById.get(p.id)?.status !== "ended",
    )

    // Name lookup — batch by store to stay policy-safe:
    //   - home-store hostess names: caller's store only
    //   - foreign-store hostess names: only for those currently a participant
    //     in an active session of caller's store (already implied by the
    //     `participants` array).
    const homeMembershipIds = new Set<string>()
    const foreignMembershipIds = new Set<string>()
    const foreignOriginStoreIds = new Set<string>()
    for (const p of participants) {
      if (!p.membership_id) continue
      if (p.origin_store_uuid && p.origin_store_uuid !== storeUuid) {
        foreignMembershipIds.add(p.membership_id)
        if (p.origin_store_uuid) foreignOriginStoreIds.add(p.origin_store_uuid)
      } else {
        homeMembershipIds.add(p.membership_id)
      }
    }

    // 2026-04-30 R-Perf: Wave 1B — homeHostessRows + awayRows 병렬 fetch.
    //   둘 다 storeUuid / origin_store_uuid 만 의존 (상호 무관). 직렬 → 병렬.
    //   awayRows 는 cross_store_work_records 테이블이 미적용된 환경에서
    //   reject 가능하므로 Promise.allSettled 로 다른 쿼리 영향 없게 격리.
    const [homeHostessSettled, awayRowsSettled] = await Promise.allSettled([
      supabase
        .from("hostesses")
        .select("membership_id, name, stage_name, is_active")
        .eq("store_uuid", storeUuid)
        .is("deleted_at", null)
        .eq("is_active", true),
      supabase
        .from("cross_store_work_records")
        .select("id, session_id, working_store_uuid, hostess_membership_id, status")
        .eq("origin_store_uuid", storeUuid)
        .in("status", ["pending", "approved"])
        .is("deleted_at", null),
    ])
    const homeHostessRows =
      homeHostessSettled.status === "fulfilled"
        ? homeHostessSettled.value.data
        : null
    const homeHostesses = (homeHostessRows ?? []) as Array<{
      membership_id: string
      name: string
      stage_name: string | null
      is_active: boolean
    }>
    const homeNameMap = new Map<string, string>()
    for (const h of homeHostesses) {
      homeNameMap.set(h.membership_id, h.stage_name?.trim() || h.name)
    }

    // 2026-04-30 R-Perf: Wave 3 — foreignRows + sRows 병렬 fetch.
    //   둘 다 foreignOriginStoreIds 의존, 상호 무관. 기존 직렬 → Promise.all.
    //   조건 만족 안 하면 placeholder Promise 로 건너뜀 (하나만 fire 되어도 OK).
    const foreignNameMap = new Map<string, { name: string; origin_store_uuid: string }>()
    const foreignStoreNameMap = new Map<string, string>()
    if (foreignOriginStoreIds.size > 0) {
      const foreignOriginStoreIdsList = Array.from(foreignOriginStoreIds)
      const wantForeignNames = foreignMembershipIds.size > 0
      const [foreignRowsRes, sRowsRes] = await Promise.all([
        wantForeignNames
          ? supabase
              .from("hostesses")
              .select("membership_id, name, stage_name, store_uuid")
              .in("store_uuid", foreignOriginStoreIdsList)
              .in("membership_id", Array.from(foreignMembershipIds))
              .is("deleted_at", null)
          : Promise.resolve({ data: null }),
        supabase
          .from("stores")
          .select("id, store_name")
          .in("id", foreignOriginStoreIdsList)
          .is("deleted_at", null),
      ])

      if (wantForeignNames) {
        for (const h of (foreignRowsRes.data ?? []) as Array<{
          membership_id: string
          name: string
          stage_name: string | null
          store_uuid: string
        }>) {
          foreignNameMap.set(h.membership_id, {
            name: h.stage_name?.trim() || h.name,
            origin_store_uuid: h.store_uuid,
          })
        }
      }
      for (const s of (sRowsRes.data ?? []) as Array<{ id: string; store_name: string }>) {
        foreignStoreNameMap.set(s.id, s.store_name)
      }
    }

    // ── Home-store workers working AT ANOTHER store right now ────────
    // Derived via cross_store_work_records where origin_store_uuid = our
    // store AND status in (pending, approved) AND the linked session is
    // still active.
    let homeAway: Array<{
      membership_id: string
      working_store_uuid: string
      session_id: string
    }> = []
    try {
      // 2026-04-30 R-Perf: awayRows 는 Wave 1B 에서 이미 fetch 완료.
      //   여기는 후속 처리 (actSessRows 직렬) 만 수행.
      const awayRowsData =
        awayRowsSettled.status === "fulfilled"
          ? awayRowsSettled.value.data
          : null
      const awayList = (awayRowsData ?? []) as Array<{
        id: string
        session_id: string
        working_store_uuid: string
        hostess_membership_id: string
        status: string
      }>
      if (awayList.length > 0) {
        const awaySessionIds = Array.from(new Set(awayList.map(a => a.session_id)))
        const { data: actSessRows } = await applyArchivedNull(
          supabase
            .from("room_sessions")
            .select("id, status")
            .in("id", awaySessionIds)
            .eq("status", "active")
            .is("deleted_at", null)
        )
        const activeAwaySessionIds = new Set((actSessRows ?? []).map((r: Row) => String(r.id)))
        homeAway = awayList
          .filter(a => activeAwaySessionIds.has(a.session_id))
          .map(a => ({
            membership_id: a.hostess_membership_id,
            working_store_uuid: a.working_store_uuid,
            session_id: a.session_id,
          }))
      }
    } catch {
      // Non-critical — if cross_store_work_records read fails, just skip
      // the "away" derivation. Monitoring remains usable.
      homeAway = []
    }

    // ── Summary counts ──────────────────────────────────────────────
    //   재실      : active participants in active sessions of this store
    //   이탈      : mid_out participants
    //   화장실    : placeholder (BLE-only signal — 0 today)
    //   외부(타층) : placeholder (BLE-only signal — 0 today)
    //   대기      : home-store hostesses currently NOT in any active session
    const activeParticipants = participants.filter(p => p.status === "active")
    const midOutParticipants = participants.filter(p => p.status === "mid_out")
    const workingHomeMemberships = new Set<string>()
    for (const p of activeParticipants) {
      if (p.membership_id && (!p.origin_store_uuid || p.origin_store_uuid === storeUuid)) {
        workingHomeMemberships.add(p.membership_id)
      }
    }
    const awayMemberships = new Set(homeAway.map(a => a.membership_id))
    const waitingCount = homeHostesses.filter(
      h => !workingHomeMemberships.has(h.membership_id) && !awayMemberships.has(h.membership_id),
    ).length

    const summary = {
      present: activeParticipants.length,       // 재실
      mid_out: midOutParticipants.length,       // 이탈
      restroom: 0,                              // 화장실 — BLE only
      external_floor: 0,                        // 외부(타층) — BLE only
      waiting: waitingCount,                    // 대기
    }

    // ── Shape rooms with derived participants ───────────────────────
    const roomView = rooms.map(r => {
      const session = sessionByRoom.get(r.room_uuid)
      const roomParticipants = session
        ? participants.filter(p => p.session_id === session.id).map(p => {
            const isForeign = p.origin_store_uuid !== null && p.origin_store_uuid !== storeUuid
            const nameEntry = isForeign
              ? foreignNameMap.get(p.membership_id ?? "")
              : p.membership_id ? { name: homeNameMap.get(p.membership_id) ?? null, origin_store_uuid: storeUuid } : null
            const op = operatorStatusById.get(p.id)
            const recommendations = deriveRecommendations({
              status: p.status,
              entered_at: p.entered_at,
              left_at: p.left_at,
              time_minutes: p.time_minutes,
              operator_status: op?.status ?? "normal",
              extension_count: op?.extension_count ?? 0,
              latest_action_id: op?.latest_action_id ?? null,
              last_applied_action_id: p.last_applied_action_id ?? null,
              nowMs: monitorNowMs,
            })
            return {
              id: p.id,
              role: p.role,
              category: p.category,
              status: p.status,
              zone:
                p.status === "active" ? ("room" as const)
                : p.status === "mid_out" ? ("mid_out" as const)
                : ("unknown" as const),
              membership_id: p.membership_id,
              display_name: nameEntry?.name ?? (p.memo || (isForeign ? "타점" : "미지정")),
              is_foreign: isForeign,
              origin_store_uuid: p.origin_store_uuid,
              origin_store_name: isForeign && p.origin_store_uuid
                ? (foreignStoreNameMap.get(p.origin_store_uuid) ?? null)
                : null,
              time_minutes: p.time_minutes,
              entered_at: p.entered_at,
              operator_status: (op?.status ?? "normal") as
                "normal" | "still_working" | "ended" | "extended",
              extension_count: op?.extension_count ?? 0,
              // Idempotency cursor for the apply flow. `latest_action_id`
              // is the most recent log row for this participant (null if
              // none). `last_applied_action_id` is the cursor stored on
              // the participant row. Client computes "pending" as
              // (latest !== null && latest !== last_applied).
              latest_action_id: op?.latest_action_id ?? null,
              last_applied_action_id: p.last_applied_action_id ?? null,
              // Apply-state overlay for the LATEST action. Null when
              // there is no apply row (e.g., action predates the
              // apply-tracking pipeline). Drives ApplyStatusBadge.
              latest_apply_status: (() => {
                const aid = op?.latest_action_id
                return aid ? (applyByActionId.get(aid)?.apply_status ?? null) : null
              })(),
              latest_apply_attempt_count: (() => {
                const aid = op?.latest_action_id
                return aid ? (applyByActionId.get(aid)?.attempt_count ?? null) : null
              })(),
              latest_apply_last_attempted_at: (() => {
                const aid = op?.latest_action_id
                return aid ? (applyByActionId.get(aid)?.last_attempted_at ?? null) : null
              })(),
              latest_apply_failure_code: (() => {
                const aid = op?.latest_action_id
                return aid ? (applyByActionId.get(aid)?.failure_code ?? null) : null
              })(),
              latest_apply_failure_message: (() => {
                const aid = op?.latest_action_id
                return aid ? (applyByActionId.get(aid)?.failure_message ?? null) : null
              })(),
              // Server-computed recommendation facts. Client filters by
              // user alert prefs; nothing here drives state.
              recommendations,
            }
          })
        : []

      return {
        room_uuid: r.room_uuid,
        room_no: r.room_no,
        room_name: r.room_name,
        floor_no: r.floor_no,
        sort_order: r.sort_order,
        session: session
          ? {
              id: session.id,
              started_at: session.started_at,
              manager_name: session.manager_name,
              customer_name_snapshot: session.customer_name_snapshot,
              customer_party_size: session.customer_party_size,
            }
          : null,
        status: session ? ("active" as const) : ("empty" as const),
        participants: roomParticipants,
      }
    })

    // ── Home-store worker roster ────────────────────────────────────
    // Rich per-worker info. For own-store workers we read from the
    // already-loaded participants/rooms. For AWAY (cross-store) home
    // workers we batch-fetch the foreign session / room / store /
    // participant rows. Information surface is minimal: store name,
    // room name, floor, category, booked minutes, entered_at, and
    // extension_count. No settlement, customer, or other-store
    // internals are exposed.
    type AwayRoom = { id: string; store_uuid: string; room_name: string | null; room_no: string; floor_no: number | null }
    type AwayStore = { id: string; store_name: string }
    type AwaySession = { id: string; store_uuid: string; room_uuid: string; started_at: string }
    type AwayPart = {
      id: string
      session_id: string
      membership_id: string
      category: string | null
      time_minutes: number | null
      entered_at: string | null
    }

    const awayList = homeAway
    const awaySessionIds = Array.from(new Set(awayList.map(a => a.session_id)))
    const awayStoreUuids = Array.from(new Set(awayList.map(a => a.working_store_uuid)))
    const awayMembershipIds = Array.from(new Set(awayList.map(a => a.membership_id)))

    const awaySessionById = new Map<string, AwaySession>()
    const awayRoomById = new Map<string, AwayRoom>()
    const awayStoreNameById = new Map<string, string>()
    const awayParticipantByKey = new Map<string, AwayPart>()
    const awayExtensionByParticipantId = new Map<string, number>()

    if (awaySessionIds.length > 0) {
      const { data: awaySessRows } = await applyArchivedNull(
        supabase
          .from("room_sessions")
          .select("id, store_uuid, room_uuid, started_at")
          .in("id", awaySessionIds)
          .is("deleted_at", null)
      )
      for (const s of (awaySessRows ?? []) as AwaySession[]) {
        awaySessionById.set(s.id, s)
      }

      const awayRoomUuids = Array.from(new Set(
        (awaySessRows ?? []).map((s: AwaySession) => s.room_uuid).filter((x): x is string => !!x),
      ))
      if (awayRoomUuids.length > 0) {
        const { data: awayRoomRows } = await supabase
          .from("rooms")
          .select("id, store_uuid, room_name, room_no, floor_no")
          .in("id", awayRoomUuids)
          .is("deleted_at", null)
        for (const r of (awayRoomRows ?? []) as AwayRoom[]) awayRoomById.set(r.id, r)
      }

      if (awayStoreUuids.length > 0) {
        const { data: awayStoreRows } = await supabase
          .from("stores")
          .select("id, store_name")
          .in("id", awayStoreUuids)
          .is("deleted_at", null)
        for (const s of (awayStoreRows ?? []) as AwayStore[]) {
          awayStoreNameById.set(s.id, s.store_name)
        }
      }

      if (awayMembershipIds.length > 0) {
        const { data: awayPartRows } = await supabase
          .from("session_participants")
          .select("id, session_id, membership_id, category, time_minutes, entered_at")
          .in("session_id", awaySessionIds)
          .in("membership_id", awayMembershipIds)
          .is("deleted_at", null)
        for (const p of (awayPartRows ?? []) as AwayPart[]) {
          awayParticipantByKey.set(`${p.session_id}:${p.membership_id}`, p)
        }

        // Extension count per foreign participant. This is OUR worker's
        // info at a foreign store — acceptable to surface. We read only
        // the minutes count, never foreign operator identities.
        const awayParticipantIds = Array.from(awayParticipantByKey.values()).map(p => p.id)
        if (awayParticipantIds.length > 0) {
          const { data: awayActRows } = await supabase
            .from("session_participant_actions")
            .select("participant_id, action_type, extension_count, acted_at")
            .in("participant_id", awayParticipantIds)
            .order("acted_at", { ascending: false })
          for (const r of (awayActRows ?? []) as Array<{
            participant_id: string
            action_type: string
            extension_count: number | null
            acted_at: string
          }>) {
            if (awayExtensionByParticipantId.has(r.participant_id)) continue
            const count = r.action_type === "extend" ? (r.extension_count ?? 0) : 0
            awayExtensionByParticipantId.set(r.participant_id, count)
          }
        }
      }
    }

    // Build a lookup for caller-store rooms for the own-store path.
    const selfRoomByUuid = new Map<string, { room_name: string; floor_no: number | null }>()
    for (const r of rooms) selfRoomByUuid.set(r.room_uuid, { room_name: r.room_name, floor_no: r.floor_no })

    const homeWorkerView = homeHostesses.map(h => {
      const working = workingHomeMemberships.has(h.membership_id)
      const awayRec = homeAway.find(a => a.membership_id === h.membership_id) ?? null
      const current_zone: "room" | "away" | "waiting" =
        working ? "room" : awayRec ? "away" : "waiting"

      let current_room_uuid: string | null = null
      let current_room_name: string | null = null
      let current_floor: number | null = null
      let current_store_name: string | null = null
      let working_store_uuid: string | null = null
      let category: string | null = null
      let current_time_minutes = 0
      let entered_at: string | null = null
      let extension_count = 0

      if (working) {
        const pRow = activeParticipants.find(p => p.membership_id === h.membership_id)
        if (pRow) {
          const sess = activeSessions.find(s => s.id === pRow.session_id)
          current_room_uuid = sess?.room_uuid ?? null
          const rInfo = current_room_uuid ? selfRoomByUuid.get(current_room_uuid) : undefined
          current_room_name = rInfo?.room_name ?? null
          current_floor = rInfo?.floor_no ?? null
          current_store_name = selfStoreName
          category = pRow.category ?? null
          current_time_minutes = pRow.time_minutes ?? 0
          entered_at = pRow.entered_at ?? null
          extension_count = operatorStatusById.get(pRow.id)?.extension_count ?? 0
        }
      } else if (awayRec) {
        working_store_uuid = awayRec.working_store_uuid
        const sess = awaySessionById.get(awayRec.session_id)
        current_room_uuid = sess?.room_uuid ?? null
        const room = current_room_uuid ? awayRoomById.get(current_room_uuid) : undefined
        current_room_name = room?.room_name ?? null
        current_floor = room?.floor_no ?? null
        current_store_name = awayStoreNameById.get(awayRec.working_store_uuid) ?? null
        const p = awayParticipantByKey.get(`${awayRec.session_id}:${h.membership_id}`)
        if (p) {
          category = p.category ?? null
          current_time_minutes = p.time_minutes ?? 0
          entered_at = p.entered_at ?? null
          extension_count = awayExtensionByParticipantId.get(p.id) ?? 0
        }
      }

      return {
        membership_id: h.membership_id,
        display_name: h.stage_name?.trim() || h.name,
        current_zone,
        current_room_uuid,
        current_room_name,
        current_floor,
        current_store_name,
        working_store_uuid,
        category,
        current_time_minutes,
        entered_at,
        extension_count,
      }
    })

    // ── Foreign workers view (only while participating in THIS store
    //    active session) ──────────────────────────────────────────────
    const foreignWorkerView = activeParticipants
      .filter(p => p.origin_store_uuid && p.origin_store_uuid !== storeUuid && p.membership_id)
      .map(p => {
        const nameEntry = foreignNameMap.get(p.membership_id as string)
        const sess = activeSessions.find(s => s.id === p.session_id)
        return {
          membership_id: p.membership_id,
          display_name: nameEntry?.name ?? "타점",
          origin_store_uuid: p.origin_store_uuid,
          origin_store_name: p.origin_store_uuid
            ? (foreignStoreNameMap.get(p.origin_store_uuid) ?? null)
            : null,
          session_id: p.session_id,
          current_room_uuid: sess?.room_uuid ?? null,
          entered_at: p.entered_at,
        }
      })

    // ── BLE presence overlay (read-only) ────────────────────────────
    // Joins `ble_tag_presence` (TTL-filtered to 5 min) with `ble_tags`
    // and `ble_gateways` to derive a zone per detection.
    //
    // Strict safety:
    //   - scoped to caller's store_uuid
    //   - only rows with an ACTIVE tag + resolvable home-store membership
    //     (foreign hostesses already surface via active-session
    //     participants; a BLE read for a foreign hostess not in an
    //     active local session is suppressed to respect rule 11-13)
    //   - the presence data never mutates participants, sessions,
    //     time_segments, or settlements — it is pure display overlay
    //
    // Zone derivation uses `ble_gateways.gateway_type` (existing
    // column, already defaults to 'room'). Recognized values:
    //   'room' | 'counter' | 'restroom' | 'elevator' |
    //   'external_floor' | 'lounge'
    // Unknown/missing values fall back to 'unknown'.
    type BleZone = "room" | "counter" | "restroom" | "elevator" | "external_floor" | "lounge" | "unknown"
    type BlePresenceOut = {
      membership_id: string
      display_name: string
      zone: BleZone
      room_uuid: string | null
      last_seen_at: string
      last_event_type: string | null
      /** "ble" = raw BLE reading; "corrected" = human correction overlay. */
      source: "ble" | "corrected"
      corrected_by_membership_id?: string | null
      corrected_at?: string | null
      // Confidence fields populated by the later compute fold. Declared
      // optional here so the initial push() remains concise; the fold
      // always assigns all three before the response is serialized.
      confidence_level?: "high" | "medium" | "low"
      confidence_score?: number
      confidence_reasons?: string[]
    }
    let blePresence: BlePresenceOut[] = []
    let bleConfidence: "manual" | "hybrid" = "manual"
    try {
      const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const { data: presRows } = await supabase
        .from("ble_tag_presence")
        .select("minor, room_uuid, membership_id, last_event_type, last_seen_at")
        .eq("store_uuid", storeUuid)
        .gt("last_seen_at", cutoffIso)
      const presList = (presRows ?? []) as Array<{
        minor: number
        room_uuid: string | null
        membership_id: string | null
        last_event_type: string | null
        last_seen_at: string
      }>

      if (presList.length > 0) {
        // Only emit rows whose membership is a known home-store active hostess.
        // (Foreign workers already render via the active-session path.)
        const allowedMemberships = new Set(
          homeHostesses.map(h => h.membership_id),
        )

        // Resolve gateway_type per presence row by room_uuid match
        // (the ingest upserts `room_uuid` equal to the gateway's room).
        // Gateways with no room_uuid (hallway gateways) are matched by
        // gateway_type when no better binding exists; for this read we
        // keep it simple — if presence.room_uuid is null we mark zone
        // as 'unknown'.
        const bleRoomUuids = Array.from(
          new Set(presList.map(p => p.room_uuid).filter((r): r is string => !!r)),
        )
        const gatewayTypeByRoom = new Map<string, string>()
        if (bleRoomUuids.length > 0) {
          const { data: gwRows } = await supabase
            .from("ble_gateways")
            .select("room_uuid, gateway_type")
            .eq("store_uuid", storeUuid)
            .in("room_uuid", bleRoomUuids)
            .eq("is_active", true)
          for (const g of (gwRows ?? []) as Array<{ room_uuid: string | null; gateway_type: string | null }>) {
            if (g.room_uuid) gatewayTypeByRoom.set(g.room_uuid, g.gateway_type ?? "room")
          }
        }

        const RECOGNIZED: ReadonlyArray<BleZone> =
          ["room", "counter", "restroom", "elevator", "external_floor", "lounge"] as const
        const mapZone = (gt: string | null | undefined, hasRoom: boolean): BleZone => {
          if (!gt) return hasRoom ? "room" : "unknown"
          if ((RECOGNIZED as ReadonlyArray<string>).includes(gt)) return gt as BleZone
          return hasRoom ? "room" : "unknown"
        }

        for (const p of presList) {
          if (!p.membership_id || !allowedMemberships.has(p.membership_id)) continue
          const zone = mapZone(
            p.room_uuid ? gatewayTypeByRoom.get(p.room_uuid) ?? null : null,
            !!p.room_uuid,
          )
          const name = homeNameMap.get(p.membership_id) ?? null
          if (!name) continue // skip unknown-name rows to avoid leaking raw ids
          blePresence.push({
            membership_id: p.membership_id,
            display_name: name,
            zone,
            room_uuid: p.room_uuid,
            last_seen_at: p.last_seen_at,
            last_event_type: p.last_event_type,
            source: "ble",
          })
        }
      }

      // ── Human correction overlay ──────────────────────────────────
      // Fetch latest active corrections for this store. Scope by
      // currently visible context so a correction whose session /
      // participant has ended stops affecting live display (the row
      // persists in DB for analytics).
      type CorrRow = {
        membership_id: string
        participant_id: string | null
        session_id: string | null
        corrected_zone: string
        corrected_room_uuid: string | null
        corrected_by_membership_id: string | null
        corrected_at: string
      }
      const { data: corrRaw } = await supabase
        .from("ble_presence_corrections")
        .select("membership_id, participant_id, session_id, corrected_zone, corrected_room_uuid, corrected_by_membership_id, corrected_at")
        .eq("store_uuid", storeUuid)
        .eq("is_active", true)
        .order("corrected_at", { ascending: false })
      const corrRows = (corrRaw ?? []) as CorrRow[]
      if (corrRows.length > 0) {
        const activeSessionIdSet = new Set(activeSessions.map(s => s.id))
        const visibleParticipantIdSet = new Set(participants.map(p => p.id))
        const visibleMemberships = new Set<string>()
        for (const h of homeHostesses) visibleMemberships.add(h.membership_id)
        for (const p of participants) {
          if (p.membership_id) visibleMemberships.add(p.membership_id)
        }

        const RECOGNIZED: ReadonlyArray<BleZone> =
          ["room", "counter", "restroom", "elevator", "external_floor", "lounge"] as const

        // Keep latest correction per membership (rows are already ordered DESC).
        const latestByMember = new Map<string, CorrRow>()
        for (const c of corrRows) {
          if (latestByMember.has(c.membership_id)) continue
          // Scope filter — correction must be relevant to current context.
          if (!visibleMemberships.has(c.membership_id)) continue
          if (c.participant_id && !visibleParticipantIdSet.has(c.participant_id)) continue
          if (c.session_id && !activeSessionIdSet.has(c.session_id)) continue
          if (!(RECOGNIZED as ReadonlyArray<string>).includes(c.corrected_zone)) continue
          latestByMember.set(c.membership_id, c)
        }

        // Apply overlay — mutate existing ble rows OR append synthetic
        // rows for corrected memberships with no raw BLE reading. The
        // raw `ble_tag_presence` table is NEVER touched.
        for (const row of blePresence) {
          const c = latestByMember.get(row.membership_id)
          if (!c) continue
          row.zone = c.corrected_zone as BleZone
          row.room_uuid = c.corrected_room_uuid
          row.source = "corrected"
          row.corrected_by_membership_id = c.corrected_by_membership_id
          row.corrected_at = c.corrected_at
          latestByMember.delete(row.membership_id)
        }
        // Any correction whose membership isn't in raw BLE → synthesize
        // a new presence entry so the UI can still show the correction.
        for (const [memberId, c] of latestByMember) {
          const name = homeNameMap.get(memberId) ?? null
          if (!name) continue
          blePresence.push({
            membership_id: memberId,
            display_name: name,
            zone: c.corrected_zone as BleZone,
            room_uuid: c.corrected_room_uuid,
            last_seen_at: c.corrected_at,
            last_event_type: null,
            source: "corrected",
            corrected_by_membership_id: c.corrected_by_membership_id,
            corrected_at: c.corrected_at,
          })
        }
      }

      // ── Confidence fold (read-time only, never persisted) ─────────
      // Compute a per-row confidence from signals we already have in
      // scope: the presence row itself and the recent corrections for
      // this store. We intentionally run this AFTER the correction
      // overlay so `row.source` already reflects human-corrected
      // state when applicable. The correction list used for scoring
      // is the same one already loaded above — no new queries.
      {
        const corrForContext: CorrectionHistoryRow[] = (corrRows ?? []).map(c => ({
          membership_id: c.membership_id,
          corrected_zone: c.corrected_zone,
          corrected_room_uuid: c.corrected_room_uuid,
          corrected_at: c.corrected_at,
        }))
        const ctxByMember = buildConfidenceContextByMember(corrForContext)
        const emptyCtx = { recentCorrections: [] as CorrectionHistoryRow[] }
        for (const row of blePresence) {
          const ctx = ctxByMember.get(row.membership_id) ?? emptyCtx
          const c = computePresenceConfidence(
            {
              membership_id: row.membership_id,
              zone: row.zone,
              room_uuid: row.room_uuid,
              last_seen_at: row.last_seen_at,
              source: row.source,
            },
            ctx,
          )
          row.confidence_level = c.level
          row.confidence_score = c.score
          row.confidence_reasons = c.reasons
        }
      }

      if (blePresence.length > 0) {
        bleConfidence = "hybrid"
        // Fold BLE-derived zone counts into summary for 화장실 / 외부(타층).
        // Manual-derived 재실/이탈/대기 are NOT overridden — BLE is overlay.
        // Corrections participate in these counts since corrected zone
        // replaces raw zone on each row.
        summary.restroom = blePresence.filter(b => b.zone === "restroom").length
        summary.external_floor = blePresence.filter(b => b.zone === "external_floor").length
      }
    } catch {
      // Any failure → fall back to manual-only. Never surface 500 just
      // because BLE overlay failed to load.
      blePresence = []
      bleConfidence = "manual"
    }

    // ── Recent movement events (derived — manual sources only) ──────
    // Pulled from audit_events for this store, narrowed to state-affecting
    // session actions. Read-only and safe.
    let movement: Array<{
      at: string
      kind: string
      actor_role: string | null
      entity_table: string | null
      entity_id: string | null
      room_uuid: string | null
      session_id: string | null
    }> = []
    try {
      const { data: auditRows } = await supabase
        .from("audit_events")
        .select("created_at, action, actor_role, entity_table, entity_id, room_uuid, session_id")
        .eq("store_uuid", storeUuid)
        .in("action", [
          "session_checkin",
          "session_checkout",
          "participant_added",
          "participant_mid_out",
          "participant_deleted",
        ])
        .order("created_at", { ascending: false })
        .limit(20)
      movement = (auditRows ?? []).map((r: Row) => ({
        at: String(r.created_at),
        kind: String(r.action),
        actor_role: (r.actor_role as string | null) ?? null,
        entity_table: (r.entity_table as string | null) ?? null,
        entity_id: (r.entity_id as string | null) ?? null,
        room_uuid: (r.room_uuid as string | null) ?? null,
        session_id: (r.session_id as string | null) ?? null,
      }))
    } catch {
      movement = []
    }

    return {
      store_uuid: storeUuid,
      mode: bleConfidence === "hybrid" ? ("hybrid" as const) : ("manual" as const),
      generated_at: new Date().toISOString(),
      summary,
      rooms: roomView,
      home_workers: homeWorkerView,
      foreign_workers: foreignWorkerView,
      movement,
      ble: {
        // Read-only overlay. Populated from `ble_tag_presence` TTL-filtered
        // to the last 5 minutes and scoped to caller's store. Never drives
        // session/participant/time/settlement writes.
        confidence: bleConfidence,
        presence: blePresence,
      },
    }
  }
}

