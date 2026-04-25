import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"
import {
  resolveAmountFromParticipants,
  buildManagerMap,
  type ParticipantForResolve,
  type WorkRecordForResolve,
} from "@/lib/server/queries/staff/workLogsAggregate"

/**
 * POST /api/settlements/staff-work-logs/aggregate
 *
 * cross_store_work_records(status='confirmed') → cross_store_settlement_items
 * 편입.
 *
 * ⚠️ 2026-04-24 복구:
 *   - 대상 테이블: cross_store_work_records (staff_work_logs 미사용).
 *   - 금액 출처: session_participants.price_amount 합계.
 *     (cross_store_work_records 에 category / work_type / 금액 hint 컬럼 없음.)
 *   - item ↔ record 연결: 신규 컬럼 cross_store_settlement_items.cross_store_work_record_id
 *     (migration 075). 기존 staff_work_log_id 는 NULL 로 둔다.
 *   - record.status 는 변경하지 않는다. item 존재 여부가 "편입됨" 플래그.
 *   - 하드코딩 금액 / 퍼센트 절대 금지.
 *
 * 권한:
 *   - owner: 본인 매장(auth.store_uuid)만.
 *   - super_admin: body.origin_store_uuid override 가능.
 *   - 그 외: 403.
 *
 * 멱등:
 *   items.cross_store_work_record_id 파셜 UNIQUE(075) 로 record 1건당 item 1건.
 *   본 route 는 먼저 existing id 를 조회해 신규만 insert — 동시 실행에도
 *   UNIQUE 위배 시 재시도는 하지 않음 (다음 호출에서 자연 수렴).
 *
 * Body:
 *   { from: ISO8601, to: ISO8601, origin_store_uuid?: uuid (super_admin only) }
 *
 * 응답:
 *   { ok, processed, skipped, created_items, updated_items, skipped_reasons,
 *     settlement_ids, window }
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.\-+Z]+)?$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type WorkRecord = WorkRecordForResolve & {
  id: string
  status: string
  created_at: string
}

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────
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
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "정산 편입 권한이 없습니다." },
      { status: 403 },
    )
  }

  // ── Body ────────────────────────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as {
    from?: unknown
    to?: unknown
    origin_store_uuid?: unknown
  }
  const from = typeof body.from === "string" ? body.from : ""
  const to = typeof body.to === "string" ? body.to : ""
  if (!ISO_RE.test(from) || !ISO_RE.test(to)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "from / to 는 ISO8601 형식이어야 합니다." },
      { status: 400 },
    )
  }
  const fromIso = from.length === 10 ? `${from}T00:00:00.000Z` : from
  const toIso = to.length === 10 ? `${to}T23:59:59.999Z` : to
  if (new Date(fromIso).getTime() > new Date(toIso).getTime()) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "from 이 to 보다 이후입니다." },
      { status: 400 },
    )
  }

  let originStore = auth.store_uuid
  if (isSuperAdmin && typeof body.origin_store_uuid === "string" && body.origin_store_uuid) {
    if (!UUID_RE.test(body.origin_store_uuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "origin_store_uuid UUID 형식이 아닙니다." },
        { status: 400 },
      )
    }
    originStore = body.origin_store_uuid
  } else if (
    !isSuperAdmin &&
    typeof body.origin_store_uuid === "string" &&
    body.origin_store_uuid &&
    body.origin_store_uuid !== auth.store_uuid
  ) {
    return NextResponse.json(
      { error: "STORE_SCOPE_FORBIDDEN", message: "다른 매장을 대리할 수 없습니다." },
      { status: 403 },
    )
  }
  if (!originStore) {
    return NextResponse.json(
      { error: "STORE_REQUIRED", message: "origin_store_uuid 가 필요합니다." },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()

  // ── Step 1: 대상 work_record 로드 ───────────────────────────
  const { data: recordsRaw, error: loadErr } = await supabase
    .from("cross_store_work_records")
    .select(
      "id, session_id, working_store_uuid, origin_store_uuid, hostess_membership_id, status, created_at",
    )
    .eq("origin_store_uuid", originStore)
    .eq("status", "confirmed")
    .is("deleted_at", null)
    .gte("created_at", fromIso)
    .lte("created_at", toIso)

  if (loadErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "work_record 조회 실패", detail: loadErr.message },
      { status: 500 },
    )
  }

  const all = (recordsRaw ?? []) as unknown as WorkRecord[]
  const crossStore = all.filter((r) => r.origin_store_uuid !== r.working_store_uuid)

  if (crossStore.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      skipped: 0,
      created_items: 0,
      updated_items: 0,
      skipped_reasons: [],
      settlement_ids: [],
      window: { from, to, origin_store_uuid: originStore },
    })
  }

  // ── Step 2: 이미 item 에 연결된 record.id 제외 ─────────────
  const recordIds = crossStore.map((r) => r.id)
  const { data: existingRaw, error: existingErr } = await supabase
    .from("cross_store_settlement_items")
    .select("cross_store_work_record_id")
    .in("cross_store_work_record_id", recordIds)
    .is("deleted_at", null)
  if (existingErr) {
    // migration 075 미적용 감지: "column ... does not exist".
    const msg = String(existingErr.message ?? "")
    if (/column .*cross_store_work_record_id.* does not exist/i.test(msg)) {
      return NextResponse.json(
        {
          error: "MIGRATION_REQUIRED",
          message:
            "cross_store_settlement_items.cross_store_work_record_id 컬럼이 없습니다. database/075_cross_store_work_record_settlement_items.sql 을 먼저 적용하세요.",
          missing_migration: "075_cross_store_work_record_settlement_items.sql",
          detail: msg,
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "기존 item 조회 실패", detail: msg },
      { status: 500 },
    )
  }
  const alreadyLinked = new Set(
    ((existingRaw ?? []) as unknown as Array<{ cross_store_work_record_id: string | null }>)
      .map((r) => r.cross_store_work_record_id)
      .filter((v): v is string => !!v),
  )
  const pending = crossStore.filter((r) => !alreadyLinked.has(r.id))

  // ── Step 3: participants 로드 (amount 산출) ────────────────
  const sessionIds = [...new Set(pending.map((r) => r.session_id))]
  const hostessIds = [...new Set(pending.map((r) => r.hostess_membership_id))]
  let participants: ParticipantForResolve[] = []
  if (sessionIds.length > 0 && hostessIds.length > 0) {
    const { data: partRaw, error: partErr } = await supabase
      .from("session_participants")
      .select("session_id, membership_id, store_uuid, origin_store_uuid, price_amount, role")
      .in("session_id", sessionIds)
      .in("membership_id", hostessIds)
      .eq("role", "hostess")
      .is("deleted_at", null)
    if (partErr) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "participants 조회 실패", detail: partErr.message },
        { status: 500 },
      )
    }
    participants = (partRaw ?? []) as unknown as ParticipantForResolve[]
  }

  // ── Step 4: hostesses.manager_membership_id 매핑 ────────────
  const managerMap = new Map<string, string | null>()
  if (hostessIds.length > 0) {
    const { data: hostessRowsRaw } = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id")
      .in("membership_id", hostessIds)
      .eq("store_uuid", originStore)
      .is("deleted_at", null)
    const rows = (hostessRowsRaw ?? []) as unknown as Array<{
      membership_id: string
      manager_membership_id: string | null
    }>
    for (const [k, v] of buildManagerMap(rows)) managerMap.set(k, v)
  }

  // ── Step 5: record 별 amount 결정 + skip 분류 ──────────────
  type Priced = {
    record: WorkRecord
    amount: number
    managerId: string | null
  }
  const priced: Priced[] = []
  const skippedReasons: Array<{ id: string; reason: string }> = []

  for (const r of pending) {
    const resolution = resolveAmountFromParticipants(
      {
        session_id: r.session_id,
        hostess_membership_id: r.hostess_membership_id,
        working_store_uuid: r.working_store_uuid,
        origin_store_uuid: r.origin_store_uuid,
      },
      participants,
    )
    if (!resolution.ok) {
      skippedReasons.push({ id: r.id, reason: resolution.reason })
      continue
    }
    const managerId = managerMap.get(r.hostess_membership_id) ?? null
    priced.push({ record: r, amount: resolution.amount, managerId })
  }

  // ── Step 6: (origin, working) 그룹핑 → header 확보 + items insert ──
  const groups = new Map<string, Priced[]>()
  for (const pl of priced) {
    const key = `${pl.record.origin_store_uuid}__${pl.record.working_store_uuid}`
    const arr = groups.get(key) ?? []
    arr.push(pl)
    groups.set(key, arr)
  }

  const nowIso = new Date().toISOString()
  let createdItems = 0
  const settlementIds: string[] = []

  for (const groupRows of groups.values()) {
    const first = groupRows[0].record
    // Canonical (036): from = payer (working), to = receiver (origin).
    const fromStore = first.working_store_uuid
    const toStore = first.origin_store_uuid

    // 6-1. Header find-or-create. 035 / 036 양쪽 컬럼셋 호환: from_store_uuid /
    //       to_store_uuid (신 canonical) + store_uuid / target_store_uuid (legacy).
    const { data: existingHeaders, error: findErr } = await supabase
      .from("cross_store_settlements")
      .select("id, total_amount, remaining_amount")
      .eq("from_store_uuid", fromStore)
      .eq("to_store_uuid", toStore)
      .eq("status", "open")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
    if (findErr) {
      return NextResponse.json(
        { error: "HEADER_LOOKUP_FAILED", message: "정산 헤더 조회 실패", detail: findErr.message },
        { status: 500 },
      )
    }

    let headerId: string
    let headerTotal: number
    let headerRemaining: number

    if (existingHeaders && existingHeaders.length > 0) {
      const h = existingHeaders[0] as {
        id: string
        total_amount: number | null
        remaining_amount: number | null
      }
      headerId = h.id
      headerTotal = Number(h.total_amount ?? 0)
      headerRemaining = Number(h.remaining_amount ?? 0)
    } else {
      // Phase 10 (2026-04-24) schema-drift fix:
      //   038_cross_store_legacy_drop.sql DROPped store_uuid / target_store_uuid
      //   / note from cross_store_settlements header. live columns are:
      //     id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount,
      //     remaining_amount, status, memo, created_by, created_at, updated_at,
      //     deleted_at.
      //   note → memo 로 단일화 (memo 가 SSOT, live 컬럼).
      const { data: headerIns, error: headerErr } = await supabase
        .from("cross_store_settlements")
        .insert({
          from_store_uuid: fromStore,
          to_store_uuid: toStore,
          total_amount: 0,
          prepaid_amount: 0,
          remaining_amount: 0,
          status: "open",
          memo: `cross_store_work_records aggregate ${from}~${to}`,
          created_by: auth.user_id,
        })
        .select("id")
        .single()
      if (headerErr || !headerIns) {
        return NextResponse.json(
          { error: "HEADER_INSERT_FAILED", message: "정산 헤더 생성 실패", detail: headerErr?.message },
          { status: 500 },
        )
      }
      headerId = (headerIns as unknown as { id: string }).id
      headerTotal = 0
      headerRemaining = 0
    }
    if (!settlementIds.includes(headerId)) settlementIds.push(headerId)

    // 6-2. item rows
    //
    // Phase 10 (2026-04-24) schema state:
    //   - 038_cross_store_legacy_drop.sql DROPped (items):
    //       target_manager_membership_id, assigned_amount, prepaid_amount
    //   - 075_cross_store_work_record_settlement_items APPLIED
    //       (this round) → cross_store_work_record_id 컬럼 + partial UNIQUE
    //       (uq_cssi_cross_store_work_record) 활성. record 1건당 item 1건
    //       idempotency 가 DB 레벨에서 강제됨.
    //   - 060 (hostess_membership_id / category / work_type) 는 여전히 미적용
    //       → 해당 필드는 INSERT payload 에서 제외.
    //   amount calculation unchanged.
    const itemRows = groupRows.map(({ record, amount, managerId }) => ({
      cross_store_settlement_id: headerId,
      store_uuid: fromStore,
      target_store_uuid: toStore,
      manager_membership_id: managerId,
      // 075 컬럼 — partial UNIQUE 로 재aggregate 중복 방지.
      cross_store_work_record_id: record.id,
      amount,
      paid_amount: 0,
      remaining_amount: amount,
      // live CHECK chk_csi_status allows only {'open','partial','completed'}.
      // aggregate 단계는 "미지급" = 'open' 이 정식 초기 상태. 이후 RPC 가
      // payout 진행 시 'partial' / 'completed' 로 전이.
      status: "open",
    }))

    // 최종 방어: amount <= 0 / 비유한 값 차단
    for (const row of itemRows) {
      if (!Number.isFinite(row.amount) || row.amount <= 0) {
        return NextResponse.json(
          {
            error: "INVARIANT_VIOLATION",
            message: "amount 가 0 이하인 라인이 감지되었습니다.",
            detail: {
              cross_store_work_record_id: row.cross_store_work_record_id,
              amount: row.amount,
            },
          },
          { status: 500 },
        )
      }
    }

    // 6-3. insert. uq_cssi_cross_store_work_record (partial UNIQUE on
    //   cross_store_work_record_id WHERE NOT NULL AND deleted_at IS NULL) 가
    //   race / 재실행 중복을 DB 층에서 차단. alreadyLinked set 은 1차 방어.
    const { data: insertedItems, error: itemsErr } = await supabase
      .from("cross_store_settlement_items")
      .insert(itemRows)
      .select("id, cross_store_work_record_id, amount")

    if (itemsErr) {
      return NextResponse.json(
        { error: "ITEMS_INSERT_FAILED", message: "정산 라인 생성 실패", detail: itemsErr.message },
        { status: 500 },
      )
    }

    const inserted = (insertedItems ?? []) as unknown as Array<{
      id: string
      cross_store_work_record_id: string | null
      amount: number | null
    }>
    const actualTotal = inserted.reduce((s, r) => s + Number(r.amount ?? 0), 0)
    createdItems += inserted.length

    // 6-4. header total 갱신 (실제 insert 된 amount 만큼 누적)
    if (actualTotal > 0) {
      const { error: creditErr } = await supabase
        .from("cross_store_settlements")
        .update({
          total_amount: headerTotal + actualTotal,
          remaining_amount: headerRemaining + actualTotal,
          updated_at: nowIso,
        })
        .eq("id", headerId)
        .is("deleted_at", null)
      if (creditErr) {
        return NextResponse.json(
          { error: "HEADER_CREDIT_FAILED", message: "정산 헤더 크레딧 실패", detail: creditErr.message },
          { status: 500 },
        )
      }
    }
  }

  // ── Step 7: audit ──────────────────────────────────────────
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "cross_store_work_records_aggregated",
    entity_table: "cross_store_settlements",
    entity_id: originStore,
    metadata: {
      origin_store_uuid: originStore,
      from,
      to,
      candidate_count: crossStore.length,
      already_linked: alreadyLinked.size,
      priced: priced.length,
      skipped: skippedReasons.length,
      created_items: createdItems,
      settlement_ids: settlementIds,
    },
  })
  if (auditFail) return auditFail

  // skipped 세부 카운트
  const participantNotFoundCount = skippedReasons.filter((s) => s.reason === "participant_not_found").length
  const amountZeroCount = skippedReasons.filter((s) => s.reason === "amount_zero").length
  // unassigned (hostess 의 manager null) — 생성된 priced 중 managerId null 건수
  const unassignedCount = priced.filter((p) => p.managerId === null).length

  return NextResponse.json({
    ok: true,
    processed: priced.length,
    skipped: skippedReasons.length + alreadyLinked.size,
    created_items: createdItems,
    updated_items: 0,
    skipped_reasons: skippedReasons,
    skipped_counts: {
      participant_not_found: participantNotFoundCount,
      amount_zero: amountZeroCount,
      already_linked: alreadyLinked.size,
    },
    unassigned_count: unassignedCount,
    already_linked_count: alreadyLinked.size,
    settlement_ids: settlementIds,
    window: { from, to, origin_store_uuid: originStore },
  })
}
