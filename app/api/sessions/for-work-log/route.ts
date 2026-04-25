import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/sessions/for-work-log
 *
 * Phase 10 (2026-04-24): cross_store_work_records (= staff-work-logs) 등록
 *   UX 지원. WorkLogModal 에서 working_store 의 세션 목록을 dropdown 으로
 *   제공하기 위한 **조회 전용** 엔드포인트.
 *
 * 목적:
 *   /api/rooms 는 auth.store_uuid 로 고정 scope → 타매장 세션을 볼 수 없어
 *   cross-store 근무 기록이 UUID 수동 입력에 의존했다. 본 엔드포인트는
 *   "내 매장 hostess 가 실제로 참여한 working_store 세션" 만 노출하여
 *   정보 누출 없이 선택 기능을 제공한다.
 *
 * 권한:
 *   - owner / manager / super_admin.
 *   - hostess / waiter / staff: 403.
 *
 * Scope 규칙:
 *   - super_admin: 제한 없음.
 *   - working_store_uuid === auth.store_uuid (self): 모든 세션 반환
 *     (/api/rooms 와 동등).
 *   - working_store_uuid !== auth.store_uuid (cross):
 *       `session_participants.origin_store_uuid = auth.store_uuid
 *        AND session_participants.store_uuid = working_store_uuid`
 *       인 row 가 존재하는 session 만 반환. 즉 "내 매장 hostess 가 저 매장에
 *       실제로 참여한 세션" 만 볼 수 있음 (다른 매장 운영 데이터 노출 차단).
 *
 * Query:
 *   working_store_uuid    (required, uuid)
 *   include_closed_hours  (optional, default 24; min 0 max 168)
 *
 * 응답:
 *   {
 *     working_store_uuid,
 *     sessions: [{
 *       id, room_uuid, room_no, room_name,
 *       status, started_at, ended_at,
 *       business_day_id,
 *       customer_name_snapshot
 *     }]
 *   }
 *
 * ⚠️ 본 라우트는 mutation 없음. audit 기록 없음 (GET + 조회만).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isManager && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "조회 권한이 없습니다." },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const workingStoreUuid = (url.searchParams.get("working_store_uuid") ?? "").trim()
  if (!UUID_RE.test(workingStoreUuid)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "working_store_uuid 는 uuid 여야 합니다." },
      { status: 400 },
    )
  }

  const rawHours = Number(url.searchParams.get("include_closed_hours") ?? "24")
  const hours = Number.isFinite(rawHours)
    ? Math.min(168, Math.max(0, Math.floor(rawHours)))
    : 24
  const closedCutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const supabase = getServiceClient()

  // ── Scope: self | cross-store | super_admin ─────────────────
  const isSelf = workingStoreUuid === auth.store_uuid

  // cross-store scope 필터: 본 매장 hostess 가 해당 working_store 세션에
  //   실제로 참여한 session_id 집합을 먼저 구성.
  let allowedSessionIds: string[] | null = null
  if (!isSuperAdmin && !isSelf) {
    const { data: scopedPart, error: spErr } = await supabase
      .from("session_participants")
      .select("session_id")
      .eq("store_uuid", workingStoreUuid)
      .eq("origin_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    if (spErr) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "scope 조회 실패", detail: spErr.message },
        { status: 500 },
      )
    }
    const ids = new Set<string>()
    for (const r of (scopedPart ?? []) as { session_id: string | null }[]) {
      if (r.session_id) ids.add(r.session_id)
    }
    if (ids.size === 0) {
      return NextResponse.json({
        working_store_uuid: workingStoreUuid,
        sessions: [],
        scope: "cross_store_no_participation",
      })
    }
    allowedSessionIds = Array.from(ids)
  }

  // ── Session 조회 ───────────────────────────────────────────
  let q = supabase
    .from("room_sessions")
    .select(
      "id, room_uuid, store_uuid, status, started_at, ended_at, business_day_id, customer_name_snapshot",
    )
    .eq("store_uuid", workingStoreUuid)
    .is("deleted_at", null)
    .in("status", ["active", "closed"])

  if (allowedSessionIds !== null) {
    q = q.in("id", allowedSessionIds)
  }

  const { data: sessionsRaw, error: sErr } = await q
  if (sErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "session 조회 실패", detail: sErr.message },
      { status: 500 },
    )
  }

  type SessRow = {
    id: string
    room_uuid: string
    store_uuid: string
    status: string
    started_at: string
    ended_at: string | null
    business_day_id: string
    customer_name_snapshot: string | null
  }
  const sessions = ((sessionsRaw ?? []) as unknown as SessRow[]).filter((s) => {
    if (s.status === "active") return true
    if (s.status === "closed" && s.ended_at && s.ended_at > closedCutoffIso) return true
    return false
  })

  // ── Room enrichment (room_no / room_name) ─────────────────
  const roomIds = [...new Set(sessions.map((s) => s.room_uuid))]
  const roomMap = new Map<string, { room_no: string; room_name: string | null }>()
  if (roomIds.length > 0) {
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_no, room_name")
      .in("id", roomIds)
      .is("deleted_at", null)
    for (const r of (rooms ?? []) as {
      id: string
      room_no: string
      room_name: string | null
    }[]) {
      roomMap.set(r.id, { room_no: r.room_no, room_name: r.room_name })
    }
  }

  const out = sessions
    .map((s) => {
      const room = roomMap.get(s.room_uuid)
      return {
        id: s.id,
        room_uuid: s.room_uuid,
        room_no: room?.room_no ?? "?",
        room_name: room?.room_name ?? null,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        business_day_id: s.business_day_id,
        customer_name_snapshot: s.customer_name_snapshot,
      }
    })
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))

  return NextResponse.json({
    working_store_uuid: workingStoreUuid,
    sessions: out,
    scope: isSuperAdmin ? "super_admin" : isSelf ? "self" : "cross_store",
  })
}
