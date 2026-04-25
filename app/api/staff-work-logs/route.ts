import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"
import { UUID_RE, WORK_LOG_SELECT_COLS } from "@/lib/server/queries/staff/workLogLifecycle"

/**
 * Staff Work Logs — cross_store_work_records 기준 API.
 *
 * ⚠️ 2026-04-24 재작성:
 *   라이브 DB 에 `staff_work_logs` 테이블이 없고 `cross_store_work_records`
 *   만 존재. 본 route 는 해당 테이블 실 컬럼에 맞춰 다시 작성됐다.
 *   staff_work_logs 로 되돌리는 작업이 아니며, `manager_membership_id` /
 *   `started_at` / `ended_at` / `category` / `work_type` / `memo` /
 *   `source` / `created_by` / `working_store_room_*` / `external_amount_hint`
 *   등 과거 컬럼은 cross_store_work_records 에 존재하지 않아 전부 제거됨.
 *
 *   다른 테이블 (sessions / session_participants / hostesses / customers)
 *   의 `manager_membership_id` 는 **그대로 유지**. 본 라운드는 staff-work-logs
 *   API 계열만 대상.
 *
 * POST /api/staff-work-logs
 *   cross_store_work_records 1건 생성 (status = 'pending').
 *   requested_by = auth.membership_id. approved_by/at = null.
 *
 * GET /api/staff-work-logs
 *   origin scope 조회 (auth.store_uuid). manager 는 requested_by = auth.membership_id
 *   로 자기 요청 건만 노출 (manager_membership_id 컬럼이 없어진 대체).
 *
 * 인바리언트:
 *   - 쓰기: owner / manager / super_admin
 *     manager 는 hostesses.manager_membership_id === auth.membership_id 인
 *     스태프만 기록 (조회 전용 게이트. cross_store_work_records 에는 저장 안 함).
 *   - hostess home store == auth.store_uuid (store_memberships 검증).
 *   - working_store 는 존재 + is_active.
 *   - session_id / business_day_id 존재 검증 (필수 FK).
 */

type SwlBody = {
  hostess_membership_id?: unknown
  working_store_uuid?: unknown
  session_id?: unknown
  business_day_id?: unknown
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

// ─── POST: create a new work record (status=pending) ────────
export async function POST(request: Request) {
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
    return bad("ROLE_FORBIDDEN", "근무 기록 권한이 없습니다.", 403)
  }

  const body = (await request.json().catch(() => ({}))) as SwlBody

  const hostessMembershipId =
    typeof body.hostess_membership_id === "string" ? body.hostess_membership_id.trim() : ""
  const workingStoreUuid =
    typeof body.working_store_uuid === "string" ? body.working_store_uuid.trim() : ""
  const sessionId =
    typeof body.session_id === "string" ? body.session_id.trim() : ""
  const businessDayId =
    typeof body.business_day_id === "string" ? body.business_day_id.trim() : ""

  if (!UUID_RE.test(hostessMembershipId))
    return bad("MISSING_FIELDS", "hostess_membership_id 가 필요합니다.")
  if (!UUID_RE.test(workingStoreUuid))
    return bad("MISSING_FIELDS", "working_store_uuid 가 필요합니다.")
  if (!UUID_RE.test(sessionId))
    return bad("MISSING_FIELDS", "session_id 가 필요합니다.")
  if (!UUID_RE.test(businessDayId))
    return bad("MISSING_FIELDS", "business_day_id 가 필요합니다.")

  const supabase = getServiceClient()

  // ── hostess 유효성 + origin scope ───────────────────────
  const { data: hostessMem, error: hostessMemErr } = await supabase
    .from("store_memberships")
    .select("id, role, status, store_uuid")
    .eq("id", hostessMembershipId)
    .is("deleted_at", null)
    .maybeSingle()
  if (hostessMemErr) return bad("INTERNAL_ERROR", "스태프 조회 실패", 500)
  if (!hostessMem) return bad("HOSTESS_NOT_FOUND", "스태프를 찾을 수 없습니다.", 404)
  if (hostessMem.role !== "hostess" || hostessMem.status !== "approved")
    return bad("HOSTESS_ROLE_INVALID", "스태프 멤버십이 유효하지 않습니다.", 400)
  if (hostessMem.store_uuid !== auth.store_uuid)
    return bad(
      "STORE_SCOPE_FORBIDDEN",
      "본 매장 소속 스태프만 기록할 수 있습니다.",
      403,
    )

  // ── manager 권한 제약 — 자기 담당만 ───────────────────
  //   hostesses.manager_membership_id 는 "담당 실장 검증" 용도로만 읽고,
  //   cross_store_work_records 에는 저장하지 않는다 (테이블에 없는 컬럼).
  if (isManager && !isOwner && !isSuperAdmin) {
    const { data: hostessRow } = await supabase
      .from("hostesses")
      .select("manager_membership_id")
      .eq("membership_id", hostessMembershipId)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const assignedMgr = (hostessRow?.manager_membership_id as string | null) ?? null
    if (assignedMgr !== auth.membership_id) {
      return bad(
        "ASSIGNMENT_FORBIDDEN",
        "자기 담당 스태프만 기록할 수 있습니다.",
        403,
      )
    }
  }

  // ── working_store 유효성 ────────────────────────────────
  const { data: workingStore, error: wsErr } = await supabase
    .from("stores")
    .select("id, is_active")
    .eq("id", workingStoreUuid)
    .is("deleted_at", null)
    .maybeSingle()
  if (wsErr) return bad("INTERNAL_ERROR", "매장 조회 실패", 500)
  if (!workingStore || workingStore.is_active === false)
    return bad(
      "WORKING_STORE_NOT_FOUND",
      "근무 매장이 존재하지 않거나 비활성입니다.",
      400,
    )

  // ── session_id + business_day_id FK 검증 ────────────────
  const { data: sess } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, business_day_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!sess) return bad("SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.", 404)
  if (sess.store_uuid !== workingStoreUuid) {
    return bad(
      "SESSION_STORE_MISMATCH",
      "session_id 의 store_uuid 가 working_store_uuid 와 일치하지 않습니다.",
      400,
    )
  }
  if (sess.business_day_id !== businessDayId) {
    return bad(
      "BUSINESS_DAY_MISMATCH",
      "session 의 business_day_id 와 입력 값이 일치하지 않습니다.",
      400,
    )
  }

  // ── INSERT (cross_store_work_records 실 컬럼만) ─────────
  const { data: inserted, error: insertErr } = await supabase
    .from("cross_store_work_records")
    .insert({
      session_id: sessionId,
      business_day_id: businessDayId,
      working_store_uuid: workingStoreUuid,
      origin_store_uuid: auth.store_uuid,
      hostess_membership_id: hostessMembershipId,
      requested_by: auth.membership_id,
      approved_by: null,
      approved_at: null,
      status: "pending",
    })
    .select(WORK_LOG_SELECT_COLS)
    .single()

  const insertedRow = inserted as unknown as { id: string } | null
  if (insertErr || !insertedRow) {
    return bad(
      "INSERT_FAILED",
      `근무 기록 생성 실패: ${insertErr?.message ?? "unknown"}`,
      500,
    )
  }

  // ── Audit (fail-close) ────────────────────────────────
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "staff_work_log_created",
    entity_table: "store_memberships",
    entity_id: hostessMembershipId,
    metadata: {
      work_log_id: insertedRow.id,
      working_store_uuid: workingStoreUuid,
      origin_store_uuid: auth.store_uuid,
      session_id: sessionId,
      business_day_id: businessDayId,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, item: insertedRow }, { status: 201 })
}

// ─── GET: list in origin scope ──────────────────────────────
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
    return bad("ROLE_FORBIDDEN", "조회 권한이 없습니다.", 403)
  }

  const url = new URL(request.url)
  const hostessFilter = url.searchParams.get("hostess_membership_id") ?? ""
  const statusFilter = url.searchParams.get("status") ?? ""
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1)
  const limitRaw = Number(url.searchParams.get("limit") ?? "50") || 50
  const limit = Math.min(200, Math.max(1, limitRaw))
  const offset = (page - 1) * limit

  const supabase = getServiceClient()

  let q = supabase
    .from("cross_store_work_records")
    .select(WORK_LOG_SELECT_COLS, { count: "exact" })
    .eq("origin_store_uuid", auth.store_uuid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  // manager 는 자기가 요청한 건만 자동 필터. (cross_store_work_records 에
  //   manager_membership_id 컬럼이 없으므로 requested_by 기준으로 대체.)
  if (isManager && !isOwner && !isSuperAdmin) {
    q = q.eq("requested_by", auth.membership_id)
  }

  if (hostessFilter && UUID_RE.test(hostessFilter)) {
    q = q.eq("hostess_membership_id", hostessFilter)
  }
  if (statusFilter) {
    q = q.eq("status", statusFilter)
  }

  const workingStoreFilter = url.searchParams.get("working_store_uuid") ?? ""
  if (workingStoreFilter && UUID_RE.test(workingStoreFilter)) {
    q = q.eq("working_store_uuid", workingStoreFilter)
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1)

  if (error) {
    return bad("QUERY_FAILED", `조회 실패: ${error.message}`, 500)
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>

  // ── Enrichment: hostess_name + store_name ──
  const hostessIds = [...new Set(rows.map((r) => r.hostess_membership_id as string))]
  const storeIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.origin_store_uuid, r.working_store_uuid])
        .filter((v): v is string => typeof v === "string"),
    ),
  ]

  const hostessNameMap = new Map<string, string>()
  if (hostessIds.length > 0) {
    const { data: hosts } = await supabase
      .from("hostesses")
      .select("membership_id, name, stage_name")
      .in("membership_id", hostessIds)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    for (const h of (hosts ?? []) as {
      membership_id: string; name: string | null; stage_name: string | null
    }[]) {
      hostessNameMap.set(h.membership_id, h.stage_name || h.name || "")
    }
  }

  const storeNameMap = new Map<string, string>()
  if (storeIds.length > 0) {
    const { data: sts } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds)
      .is("deleted_at", null)
    for (const s of (sts ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  // Phase 10 P1 (2026-04-24): room_sessions 조인. 근무시간 SSOT =
  //   room_sessions.started_at / ended_at / manager_membership_id.
  //   cross_store_work_records.created_at 은 origin 등록 시각 (참고용).
  //   rooms 조인으로 room_no 추출.
  const sessionIds = [...new Set(rows.map((r) => r.session_id as string).filter(Boolean))]
  type SessJoin = {
    id: string
    room_uuid: string
    started_at: string
    ended_at: string | null
    status: string
    manager_membership_id: string | null
    manager_name: string | null
  }
  const sessMap = new Map<string, SessJoin>()
  let roomIds: string[] = []
  if (sessionIds.length > 0) {
    const { data: sessRows } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, started_at, ended_at, status, manager_membership_id, manager_name")
      .in("id", sessionIds)
      .is("deleted_at", null)
    for (const s of (sessRows ?? []) as SessJoin[]) {
      sessMap.set(s.id, s)
    }
    roomIds = [...new Set(Array.from(sessMap.values()).map((s) => s.room_uuid))]
  }
  const roomMap = new Map<string, { room_no: string; room_name: string | null }>()
  if (roomIds.length > 0) {
    const { data: roomRows } = await supabase
      .from("rooms")
      .select("id, room_no, room_name")
      .in("id", roomIds)
      .is("deleted_at", null)
    for (const r of (roomRows ?? []) as {
      id: string
      room_no: string
      room_name: string | null
    }[]) {
      roomMap.set(r.id, { room_no: r.room_no, room_name: r.room_name })
    }
  }

  const items = rows.map((r) => {
    const sess = sessMap.get(r.session_id as string) ?? null
    const room = sess ? roomMap.get(sess.room_uuid) ?? null : null
    return {
      ...r,
      hostess_name: hostessNameMap.get(r.hostess_membership_id as string) ?? "",
      working_store_name: storeNameMap.get(r.working_store_uuid as string) ?? "",
      origin_store_name: storeNameMap.get(r.origin_store_uuid as string) ?? "",
      // session SSOT (근무 시간 기준)
      session_started_at: sess?.started_at ?? null,
      session_ended_at: sess?.ended_at ?? null,
      session_status: sess?.status ?? null,
      session_manager_membership_id: sess?.manager_membership_id ?? null,
      session_manager_name: sess?.manager_name ?? null,
      room_no: room?.room_no ?? null,
      room_name: room?.room_name ?? null,
    }
  })

  const pendingCount = items.filter((r) => (r as { status?: string }).status === "pending").length

  return NextResponse.json({
    ok: true,
    items,
    page,
    limit,
    total: count ?? 0,
    summary: {
      total: count ?? items.length,
      pending_count: pendingCount,
    },
  })
}
