import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * Staff Work Logs — Phase 1 (manual only)
 *
 * POST /api/staff-work-logs
 *   아가씨 한 명의 근무 이벤트를 1-row 로 기록 (draft 상태).
 *
 * GET /api/staff-work-logs
 *   원(origin) 스코프 조회. manager 는 자기 담당만 자동 필터.
 *
 * Constraints (Phase 1 strict):
 *   - settlement 연결 필드는 채우지 않음 (cross_store_settlement_id 등)
 *   - BLE 관련 필드는 default 만 (source='manual', ble_event_id=null)
 *   - 기존 session/participants 수정/참조 금지 (FK 도 null 고정)
 *   - store_uuid scope: origin_store_uuid === auth.store_uuid 강제
 *
 * 인바리언트:
 *   - 쓰기: owner/manager/super_admin 만.
 *     manager 는 hostess.manager_membership_id === auth.membership_id 일 때만.
 *   - 아가씨의 home store == auth.store_uuid (store_memberships 검증).
 *   - working_store 는 존재 + is_active (타매장 포함 허용).
 *   - 같은 아가씨 겹치는 시간대 (draft/confirmed/settled) 존재 시 409 TIME_CONFLICT.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_CATEGORY = ["public", "shirt", "hyper", "etc"] as const
const ALLOWED_WORK_TYPE = ["full", "half", "cha3", "half_cha3"] as const

type SwlBody = {
  hostess_membership_id?: unknown
  working_store_uuid?: unknown
  started_at?: unknown
  ended_at?: unknown
  working_store_room_label?: unknown
  working_store_room_uuid?: unknown
  category?: unknown
  work_type?: unknown
  external_amount_hint?: unknown
  memo?: unknown
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

// ─── POST: create a new work log (draft) ────────────────────
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

  // ── 필드 파싱 / 기본 검증 ───────────────────────────────
  const hostessMembershipId =
    typeof body.hostess_membership_id === "string" ? body.hostess_membership_id.trim() : ""
  const workingStoreUuid =
    typeof body.working_store_uuid === "string" ? body.working_store_uuid.trim() : ""
  const startedAtRaw = typeof body.started_at === "string" ? body.started_at : ""
  const endedAtRaw = typeof body.ended_at === "string" ? body.ended_at : ""
  const roomLabel =
    typeof body.working_store_room_label === "string"
      ? body.working_store_room_label.trim()
      : ""
  const roomUuid =
    typeof body.working_store_room_uuid === "string"
      ? body.working_store_room_uuid.trim()
      : ""
  const category = typeof body.category === "string" ? body.category : ""
  const workType = typeof body.work_type === "string" ? body.work_type : ""
  const amountHintRaw =
    typeof body.external_amount_hint === "number" ? body.external_amount_hint : null
  const memo = typeof body.memo === "string" ? body.memo.trim() : ""

  if (!UUID_RE.test(hostessMembershipId))
    return bad("MISSING_FIELDS", "hostess_membership_id 가 필요합니다.")
  if (!UUID_RE.test(workingStoreUuid))
    return bad("MISSING_FIELDS", "working_store_uuid 가 필요합니다.")
  if (!startedAtRaw) return bad("MISSING_FIELDS", "started_at 이 필요합니다.")
  const startedAt = new Date(startedAtRaw)
  if (Number.isNaN(startedAt.getTime()))
    return bad("TIME_INVALID", "started_at 형식이 올바르지 않습니다.")
  let endedAt: Date | null = null
  if (endedAtRaw) {
    endedAt = new Date(endedAtRaw)
    if (Number.isNaN(endedAt.getTime()))
      return bad("TIME_INVALID", "ended_at 형식이 올바르지 않습니다.")
    if (endedAt.getTime() < startedAt.getTime())
      return bad("INVALID_TIME_RANGE", "ended_at 은 started_at 이후여야 합니다.")
  }
  if (!(ALLOWED_CATEGORY as readonly string[]).includes(category))
    return bad(
      "CATEGORY_INVALID",
      "category 는 public / shirt / hyper / etc 중 하나여야 합니다.",
    )
  if (!(ALLOWED_WORK_TYPE as readonly string[]).includes(workType))
    return bad(
      "WORK_TYPE_INVALID",
      "work_type 은 full / half / cha3 / half_cha3 중 하나여야 합니다.",
    )
  if (roomUuid && !UUID_RE.test(roomUuid))
    return bad("ROOM_UUID_INVALID", "working_store_room_uuid 형식이 올바르지 않습니다.")
  if (amountHintRaw !== null && (!Number.isFinite(amountHintRaw) || amountHintRaw < 0))
    return bad("AMOUNT_INVALID", "external_amount_hint 는 0 이상의 숫자여야 합니다.")

  const supabase = getServiceClient()

  // ── hostess 유효성 + origin scope ───────────────────────
  //   hostess.home_store = auth.store_uuid 여야 함 (super_admin 도 동일 — 이번 라운드는
  //   작성자 store 귀속만 허용. super_admin 다매장 기록은 Phase 2 에서 별도 쿼리 파라미터).
  const { data: hostessMem, error: hostessMemErr } = await supabase
    .from("store_memberships")
    .select("id, role, status, store_uuid")
    .eq("id", hostessMembershipId)
    .is("deleted_at", null)
    .maybeSingle()
  if (hostessMemErr) return bad("INTERNAL_ERROR", "아가씨 조회 실패", 500)
  if (!hostessMem) return bad("HOSTESS_NOT_FOUND", "아가씨를 찾을 수 없습니다.", 404)
  if (hostessMem.role !== "hostess" || hostessMem.status !== "approved")
    return bad("HOSTESS_ROLE_INVALID", "아가씨 멤버십이 유효하지 않습니다.", 400)
  if (hostessMem.store_uuid !== auth.store_uuid)
    return bad(
      "STORE_SCOPE_FORBIDDEN",
      "본 매장 소속 아가씨만 기록할 수 있습니다.",
      403,
    )

  // ── manager 권한 제약 — 자기 담당만 ───────────────────
  //    담당 관계는 `hostesses.manager_membership_id` 에서 읽는다
  //    (NOX 의 실제 매니저–아가씨 연결 구조).
  let snapshotManagerId: string | null = null
  {
    const { data: hostessRow } = await supabase
      .from("hostesses")
      .select("manager_membership_id")
      .eq("membership_id", hostessMembershipId)
      .is("deleted_at", null)
      .maybeSingle()
    const assignedMgr = (hostessRow?.manager_membership_id as string | null) ?? null

    if (isManager && !isOwner && !isSuperAdmin) {
      if (assignedMgr !== auth.membership_id) {
        return bad(
          "ASSIGNMENT_FORBIDDEN",
          "자기 담당 아가씨만 기록할 수 있습니다.",
          403,
        )
      }
      snapshotManagerId = auth.membership_id
    } else {
      // owner / super_admin: 현재 담당 실장 스냅샷 (없을 수 있음)
      snapshotManagerId = assignedMgr
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

  // ── 시간 충돌 1차 — soft warning (이번 라운드는 hard block 금지) ──
  //   같은 hostess + 시간 겹침 + 같은 working_store + 같은 room_label
  //   4-매칭을 "의심" 으로 표시해 응답에 포함한다. 이번 라운드는
  //   ended_at < started_at 만 hard 400 (위 INVALID_TIME_RANGE 에서 처리).
  const WINDOW_MS = 5 * 60 * 1000  // ±5분 근접 시 잠재 중복으로 간주
  const windowStart = new Date(startedAt.getTime() - 4 * 60 * 60 * 1000).toISOString()
  const windowEndRef = (endedAt ?? new Date(startedAt.getTime() + 4 * 60 * 60 * 1000)).toISOString()
  const { data: candidates } = await supabase
    .from("staff_work_logs")
    .select("id, started_at, ended_at, working_store_uuid, working_store_room_label, status")
    .eq("hostess_membership_id", hostessMembershipId)
    .in("status", ["draft", "confirmed", "settled"])
    .is("deleted_at", null)
    .gte("started_at", windowStart)
    .lte("started_at", windowEndRef)

  const nextStart = startedAt.getTime()
  const nextEnd = endedAt ? endedAt.getTime() : nextStart + 1
  const conflicts: { id: string; kind: "overlap" | "near_duplicate"; started_at: string }[] = []
  for (const c of (candidates ?? []) as {
    id: string
    started_at: string
    ended_at: string | null
    working_store_uuid: string
    working_store_room_label: string | null
  }[]) {
    const cStart = new Date(c.started_at).getTime()
    const cEnd = c.ended_at ? new Date(c.ended_at).getTime() : cStart + 1
    const timeOverlap = nextStart < cEnd && cStart < nextEnd
    const nearDup =
      Math.abs(cStart - nextStart) <= WINDOW_MS &&
      c.working_store_uuid === workingStoreUuid &&
      (c.working_store_room_label ?? "") === (roomLabel || "")
    if (timeOverlap || nearDup) {
      conflicts.push({
        id: c.id,
        kind: timeOverlap ? "overlap" : "near_duplicate",
        started_at: c.started_at,
      })
    }
  }

  // ── INSERT (conflicts 가 있어도 저장 진행; UI 에 warning 전달) ────
  const { data: inserted, error: insertErr } = await supabase
    .from("staff_work_logs")
    .insert({
      origin_store_uuid: auth.store_uuid,
      working_store_uuid: workingStoreUuid,
      hostess_membership_id: hostessMembershipId,
      manager_membership_id: snapshotManagerId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt ? endedAt.toISOString() : null,
      working_store_room_label: roomLabel || null,
      working_store_room_uuid: roomUuid || null,
      category,
      work_type: workType,
      source: "manual",
      source_ref: null,
      ble_event_id: null,
      external_amount_hint: amountHintRaw,
      status: "draft",
      session_id: null,
      session_participant_id: null,
      cross_store_settlement_id: null,
      memo: memo || null,
      created_by: auth.user_id,
      created_by_role: auth.role,
    })
    .select(
      "id, origin_store_uuid, working_store_uuid, hostess_membership_id, manager_membership_id, started_at, ended_at, working_store_room_label, working_store_room_uuid, category, work_type, status, source, external_amount_hint, memo, created_at",
    )
    .single()

  if (insertErr || !inserted) {
    return bad("INSERT_FAILED", "근무 기록 생성에 실패했습니다.", 500)
  }

  // ── Audit ─────────────────────────────────────────────
  try {
    await logAuditEvent(supabase, {
      auth,
      action: "staff_work_log_created",
      entity_table: "store_memberships",
      entity_id: hostessMembershipId,
      metadata: {
        work_log_id: inserted.id,
        working_store_uuid: workingStoreUuid,
        category,
        work_type: workType,
        started_at: startedAt.toISOString(),
        ended_at: endedAt ? endedAt.toISOString() : null,
        room_label: roomLabel || null,
        source: "manual",
        conflicts_detected: conflicts.length,
      },
    })
  } catch {
    /* best-effort */
  }

  return NextResponse.json(
    {
      ok: true,
      item: inserted,
      ...(conflicts.length > 0 ? { conflicts } : {}),
    },
    { status: 201 },
  )
}

// ─── GET: list logs in own (origin) scope ───────────────────
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
  const fromStr = url.searchParams.get("from") ?? ""
  const toStr = url.searchParams.get("to") ?? ""
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1)
  const limitRaw = Number(url.searchParams.get("limit") ?? "50") || 50
  const limit = Math.min(200, Math.max(1, limitRaw))
  const offset = (page - 1) * limit

  const supabase = getServiceClient()

  let q = supabase
    .from("staff_work_logs")
    .select(
      "id, origin_store_uuid, working_store_uuid, hostess_membership_id, manager_membership_id, started_at, ended_at, working_store_room_label, working_store_room_uuid, category, work_type, source, external_amount_hint, status, memo, created_at, updated_at, created_by, created_by_role",
      { count: "exact" },
    )
    .eq("origin_store_uuid", auth.store_uuid)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })

  // manager 는 자기 담당 자동 필터 (Phase 1 정책)
  if (isManager && !isOwner && !isSuperAdmin) {
    q = q.eq("manager_membership_id", auth.membership_id)
  }

  if (hostessFilter && UUID_RE.test(hostessFilter)) {
    q = q.eq("hostess_membership_id", hostessFilter)
  }
  if (statusFilter) {
    q = q.eq("status", statusFilter)
  }
  if (fromStr) {
    const fromDate = new Date(fromStr)
    if (!Number.isNaN(fromDate.getTime())) {
      q = q.gte("started_at", fromDate.toISOString())
    }
  }
  if (toStr) {
    const toDate = new Date(toStr)
    if (!Number.isNaN(toDate.getTime())) {
      q = q.lte("started_at", toDate.toISOString())
    }
  }

  const workingStoreFilter = url.searchParams.get("working_store_uuid") ?? ""
  if (workingStoreFilter && UUID_RE.test(workingStoreFilter)) {
    q = q.eq("working_store_uuid", workingStoreFilter)
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1)

  if (error) {
    return bad("QUERY_FAILED", "조회 실패", 500)
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>

  // ── Enrichment: hostess_name + working_store_name ──
  //   /api/manager/hostesses 가 이미 사용하는 hostesses.name 경로 재사용.
  //   store 이름은 stores.store_name 으로 join. 모두 N+1 대신 in() 로 한 번.
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
    for (const s of (sts ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  const items = rows.map((r) => ({
    ...r,
    hostess_name: hostessNameMap.get(r.hostess_membership_id as string) ?? "",
    working_store_name: storeNameMap.get(r.working_store_uuid as string) ?? "",
    origin_store_name: storeNameMap.get(r.origin_store_uuid as string) ?? "",
  }))

  const draftCount = items.filter((r) => (r as { status?: string }).status === "draft").length

  return NextResponse.json({
    ok: true,
    items,
    page,
    limit,
    total: count ?? 0,
    summary: {
      total: count ?? items.length,
      draft_count: draftCount,
    },
  })
}
