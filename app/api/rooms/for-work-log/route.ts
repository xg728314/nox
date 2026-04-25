import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/rooms/for-work-log
 *
 * Phase 10 P1 (2026-04-24): /staff 근무등록 모달의 "방" 중심 세션 선택용.
 *   사용자는 매장 → 방 을 고르고, UI 는 active session_id / business_day_id
 *   를 이 응답에서 **자동 해결**. session_id 를 UI 에 노출하지 않음.
 *
 * 권한:
 *   owner / manager / super_admin. 그 외 403.
 *
 * Scope:
 *   - super_admin: 제한 없음.
 *   - self (working_store_uuid === auth.store_uuid): 해당 매장 모든 방.
 *   - cross-store: 본 매장 hostess 가 실제 참여한 working_store 방만
 *     (session_participants origin_store 필터 재사용).
 *
 * Query:
 *   working_store_uuid   (required, uuid)
 *
 * 응답:
 *   {
 *     working_store_uuid,
 *     rooms: [{
 *       room_uuid, room_no, room_name,
 *       active_session_id | null,
 *       business_day_id   | null,
 *       started_at        | null,
 *       ended_at          | null,
 *       manager_membership_id | null,
 *       manager_name      | null,
 *       session_status    | null,
 *       customer_name_snapshot | null,
 *     }]
 *   }
 *
 * ⚠️ active 우선. active 없고 최근 closed 있으면 closed session 정보 반환
 *    (운영자가 닫힌 세션에도 기록 가능). 세션 자체가 전혀 없는 방 (same-store
 *    에서만 발생) 은 active_session_id=null 로 노출 — UI 저장 disable.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLOSED_WINDOW_HOURS = 24

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

  const supabase = getServiceClient()
  const isSelf = workingStoreUuid === auth.store_uuid
  const closedCutoffIso = new Date(
    Date.now() - CLOSED_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString()

  // ── [1] Cross-store scope 필터 (self/super 는 skip) ──────────
  let allowedSessionIds: Set<string> | null = null
  if (!isSuperAdmin && !isSelf) {
    const { data: scope, error: scErr } = await supabase
      .from("session_participants")
      .select("session_id")
      .eq("store_uuid", workingStoreUuid)
      .eq("origin_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    if (scErr) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "scope 조회 실패", detail: scErr.message },
        { status: 500 },
      )
    }
    const ids = new Set<string>()
    for (const r of (scope ?? []) as { session_id: string | null }[]) {
      if (r.session_id) ids.add(r.session_id)
    }
    if (ids.size === 0) {
      return NextResponse.json({
        working_store_uuid: workingStoreUuid,
        rooms: [],
        scope: "cross_store_no_participation",
      })
    }
    allowedSessionIds = ids
  }

  // ── [2] sessions 조회 ────────────────────────────────────────
  let sessQ = supabase
    .from("room_sessions")
    .select(
      "id, room_uuid, store_uuid, status, started_at, ended_at, business_day_id, manager_membership_id, manager_name, customer_name_snapshot",
    )
    .eq("store_uuid", workingStoreUuid)
    .is("deleted_at", null)
    .in("status", ["active", "closed"])

  if (allowedSessionIds !== null) {
    sessQ = sessQ.in("id", Array.from(allowedSessionIds))
  }

  const { data: sessRaw, error: sErr } = await sessQ
  if (sErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "session 조회 실패", detail: sErr.message },
      { status: 500 },
    )
  }

  type Sess = {
    id: string
    room_uuid: string
    store_uuid: string
    status: string
    started_at: string
    ended_at: string | null
    business_day_id: string
    manager_membership_id: string | null
    manager_name: string | null
    customer_name_snapshot: string | null
  }
  const sessions = ((sessRaw ?? []) as unknown as Sess[]).filter((s) => {
    if (s.status === "active") return true
    if (s.status === "closed" && s.ended_at && s.ended_at > closedCutoffIso) return true
    return false
  })

  // 방 단위로 best session 선택: active > closed, 그 안에서 started_at desc.
  const bestByRoom = new Map<string, Sess>()
  for (const s of sessions) {
    const cur = bestByRoom.get(s.room_uuid)
    if (!cur) {
      bestByRoom.set(s.room_uuid, s)
      continue
    }
    if (cur.status === "active" && s.status !== "active") continue
    if (cur.status !== "active" && s.status === "active") {
      bestByRoom.set(s.room_uuid, s)
      continue
    }
    if (s.started_at > cur.started_at) bestByRoom.set(s.room_uuid, s)
  }

  // ── [3] rooms 조회 (self/super 는 전 방, cross-store 는 session 참여된 방만) ──
  let roomsQ = supabase
    .from("rooms")
    .select("id, room_no, room_name, sort_order, is_active")
    .eq("store_uuid", workingStoreUuid)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (allowedSessionIds !== null) {
    roomsQ = roomsQ.in("id", Array.from(bestByRoom.keys()))
  }
  const { data: roomsRaw, error: rErr } = await roomsQ
  if (rErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "rooms 조회 실패", detail: rErr.message },
      { status: 500 },
    )
  }
  type Room = { id: string; room_no: string; room_name: string | null; sort_order: number; is_active: boolean }
  const rooms = (roomsRaw ?? []) as unknown as Room[]

  // ── [4] shape ─────────────────────────────────────────────
  const out = rooms.map((r) => {
    const s = bestByRoom.get(r.id) ?? null
    return {
      room_uuid: r.id,
      room_no: r.room_no,
      room_name: r.room_name,
      active_session_id: s ? s.id : null,
      business_day_id: s ? s.business_day_id : null,
      started_at: s ? s.started_at : null,
      ended_at: s ? s.ended_at : null,
      manager_membership_id: s ? s.manager_membership_id : null,
      manager_name: s ? s.manager_name : null,
      session_status: s ? s.status : null,
      customer_name_snapshot: s ? s.customer_name_snapshot : null,
    }
  })

  return NextResponse.json({
    working_store_uuid: workingStoreUuid,
    rooms: out,
    scope: isSuperAdmin ? "super_admin" : isSelf ? "self" : "cross_store",
  })
}
