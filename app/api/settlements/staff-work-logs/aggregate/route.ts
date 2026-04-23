import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"
import {
  resolveAmount as resolveAmountPure,
  type AmountResolution,
} from "@/lib/server/queries/staffWorkLogsAggregate"

/**
 * POST /api/settlements/staff-work-logs/aggregate
 *
 * Phase 4 — staff_work_logs(confirmed) → cross_store_settlement_items 편입.
 *
 * 정책 (스펙 literal):
 *   1) 대상: status='confirmed' AND cross_store_settlement_id IS NULL
 *   2) 타매장 근무만: origin_store_uuid !== working_store_uuid
 *   3) 그룹핑 키: (origin_store_uuid, working_store_uuid)
 *   4) 동일 로그는 1회만 편입 (items.staff_work_log_id UNIQUE 로 idempotent)
 *   5) 편입 후 staff_work_logs.status = 'settled'
 *   6) settled 이후 lifecycle 변경은 공통 게이트(SETTLED_LOCKED)에서 차단
 *
 * 네이밍 (ROUND-C 단일 규약):
 *   - from_store_uuid = **payer** (돈을 지불하는 매장 = working_store)
 *   - to_store_uuid   = **receiver** (돈을 수취하는 매장 = origin_store = caller)
 *
 *   근거: migration 036 RPC 계약 (`record_cross_store_payout.p_from_store_uuid`
 *   = 지불자) + legacy reports 해석 ("Outbound from_store_uuid=us = 우리가
 *   지불할 건") 과 일치. Phase 4 이전 구현은 반대 방향이었으나 ROUND-C
 *   backfill (migration 061) 로 교환 완료.
 *
 * 권한:
 *   - owner: 본인 매장(auth.store_uuid)만 — origin_store_uuid override 금지
 *   - super_admin: body.origin_store_uuid 로 임의 매장 대리 가능
 *   - manager / staff / hostess: 403
 *
 * Body:
 *   { from: ISO8601, to: ISO8601, origin_store_uuid?: uuid (super_admin only) }
 *
 * 응답:
 *   { ok: true, processed: number }
 *
 * 금지:
 *   - receipts / session_participants 수정 금지 — 본 route 는 그 테이블에
 *     손대지 않는다.
 *   - 기존 settlement 구조 변경 금지 — 컬럼 추가는 migration 060 에서만.
 *   - BLE / 자동 스케줄러 금지 — 수동 API 만.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.\-+Z]+)?$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type WorkLog = {
  id: string
  origin_store_uuid: string
  working_store_uuid: string
  hostess_membership_id: string
  manager_membership_id: string | null
  external_amount_hint: number | null
  category: string
  work_type: string
  started_at: string
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

  // origin store 결정: super_admin 만 override 가능, owner 는 본인 매장 강제
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

  // ── Step 1: 대상 조회 ───────────────────────────────────────
  const { data: logsData, error: loadErr } = await supabase
    .from("staff_work_logs")
    .select(
      "id, origin_store_uuid, working_store_uuid, hostess_membership_id, manager_membership_id, external_amount_hint, category, work_type, started_at",
    )
    .eq("origin_store_uuid", originStore)
    .eq("status", "confirmed")
    .is("cross_store_settlement_id", null)
    .is("deleted_at", null)
    .gte("started_at", fromIso)
    .lte("started_at", toIso)

  if (loadErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "로그 조회 실패", detail: loadErr.message },
      { status: 500 },
    )
  }

  const all = (logsData ?? []) as WorkLog[]

  // ── Step 2: 타매장 필터 ────────────────────────────────────
  const eligible = all.filter((r) => r.origin_store_uuid !== r.working_store_uuid)

  if (eligible.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, skipped: 0 })
  }

  // ── Step 2.5: 단가 해석 (external_amount_hint 없으면 DB 조회) ──
  //
  // Enum 매핑 / hint 검증 로직은 lib/server/queries/staffWorkLogsAggregate.ts
  // 에 pure function 으로 추출되어 있다. 본 route 는 priceMap 을 DB 에서
  // 로드 후 pure resolver 에 위임한다.

  // origin store 의 (service_type, time_type) → price 캐시를 한 번에 로드.
  const { data: priceRows, error: priceErr } = await supabase
    .from("store_service_types")
    .select("service_type, time_type, price, is_active")
    .eq("store_uuid", originStore)
    .eq("is_active", true)
  if (priceErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "단가 테이블 조회 실패", detail: priceErr.message },
      { status: 500 },
    )
  }
  const priceMap = new Map<string, number>()
  for (const r of (priceRows ?? []) as Array<{
    service_type: string
    time_type: string
    price: number | null
  }>) {
    priceMap.set(`${r.service_type}__${r.time_type}`, Number(r.price ?? 0))
  }

  // 정책 (최종):
  //   - amount 의 기준은 **항상** store_service_types DB 단가.
  //   - external_amount_hint 는 "선호값" 이 아니라 **검증값**.
  //     hint 가 있고 DB 계산과 다르면 → skip (서버 단가를 덮어쓰지 않는다).
  //   - hint 가 없고 DB 계산이 가능하면 DB 금액으로 진행.
  // 실제 로직은 pure function `resolveAmountPure` 에 위임 (테스트 가능).
  const resolveAmount = (log: WorkLog): AmountResolution =>
    resolveAmountPure(log, priceMap)

  // 0원/불일치 방지: 해석 실패 로그는 "skipped" 로 모아서 응답에 노출.
  // skipped 로그는 settlement item 을 만들지 않고, staff_work_logs.status
  // 도 'confirmed' 그대로 유지 → 운영자가 단가 시드/hint 를 고치고 재호출.
  type PricedLog = { log: WorkLog; amount: number }
  const priced: PricedLog[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const log of eligible) {
    const r = resolveAmount(log)
    if (r.ok) priced.push({ log, amount: r.amount })
    else skipped.push({ id: log.id, reason: r.reason })
  }

  if (priced.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      skipped: skipped.length,
      skipped_details: skipped,
      message: "단가 해석 가능한 로그가 없습니다.",
    })
  }

  // ── Step 3: (origin, working) 그룹핑 ────────────────────────
  const groups = new Map<string, PricedLog[]>()
  for (const pl of priced) {
    const key = `${pl.log.origin_store_uuid}__${pl.log.working_store_uuid}`
    const arr = groups.get(key) ?? []
    arr.push(pl)
    groups.set(key, arr)
  }

  const nowIso = new Date().toISOString()
  let processed = 0

  // ── Step 4~6: 그룹별 header 확보 → items 삽입 → header 정산 → logs UPDATE ──
  //
  // 머니 인바리언트:
  //   header.total_amount(델타) === Σ(이 배치에서 실제 삽입된 items.amount)
  //
  // 이를 보장하기 위해 순서를 재배치한다:
  //   (1) 헤더 확보 — 기존 open 재사용, 없으면 totals=0 으로 신규 삽입
  //   (2) items upsert (ON CONFLICT DO NOTHING)
  //   (3) **실제 삽입된 amount 합** 으로 header 에 크레딧
  //   (4) 실제 삽입된 로그만 settled 전이
  //
  // 이렇게 하면 동시 실행 경합으로 ON CONFLICT 가 일부 로그를 skip 해도
  // header 총액이 items 합과 절대 어긋나지 않는다.
  for (const pricedLogs of groups.values()) {
    const first = pricedLogs[0].log
    // ROUND-C canonical convention: from = payer, to = receiver.
    //   working_store = 손님이 돈 낸 곳 = 지불 주체
    //   origin_store  = hostess 소속 = 수취 주체 (caller)
    const fromStore = first.working_store_uuid // canonical: from = payer
    const toStore = first.origin_store_uuid // canonical: to = receiver

    // Step 4: 기존 open settlement 재사용, 없으면 totals=0 으로 신규 생성.
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
    let headerExisted: boolean
    let headerBaselineTotal: number
    let headerBaselineRemaining: number

    if (existingHeaders && existingHeaders.length > 0) {
      const h = existingHeaders[0] as {
        id: string
        total_amount: number | null
        remaining_amount: number | null
      }
      headerId = h.id
      headerExisted = true
      headerBaselineTotal = Number(h.total_amount ?? 0)
      headerBaselineRemaining = Number(h.remaining_amount ?? 0)
    } else {
      const { data: headerIns, error: headerErr } = await supabase
        .from("cross_store_settlements")
        .insert({
          from_store_uuid: fromStore,
          to_store_uuid: toStore,
          store_uuid: fromStore, // legacy mirror (migration 035)
          target_store_uuid: toStore, // legacy mirror
          total_amount: 0, // credit in Step 5c with actualTotal
          prepaid_amount: 0,
          remaining_amount: 0,
          status: "open",
          memo: `staff_work_logs aggregate ${from}~${to}`,
          note: `staff_work_logs aggregate ${from}~${to}`,
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
      headerId = (headerIns as { id: string }).id
      headerExisted = false
      headerBaselineTotal = 0
      headerBaselineRemaining = 0
    }

    // Step 5: items insert (idempotent via UNIQUE(staff_work_log_id))
    //   모든 amount > 0 이 priced 단계에서 이미 보장됨.
    const itemRows = pricedLogs.map(({ log, amount }) => ({
      cross_store_settlement_id: headerId,
      store_uuid: fromStore,
      target_store_uuid: toStore,
      staff_work_log_id: log.id,
      hostess_membership_id: log.hostess_membership_id,
      manager_membership_id: log.manager_membership_id,
      target_manager_membership_id: log.manager_membership_id,
      amount,
      assigned_amount: amount,
      paid_amount: 0,
      prepaid_amount: 0,
      remaining_amount: amount,
      status: "open",
      category: log.category,
      work_type: log.work_type,
    }))

    // 방어적 재검증: amount <= 0 / 비유한 값 원천 차단 (여기까지 오면 안 되지만
    //   insert 전 마지막 방어선).
    for (const row of itemRows) {
      if (!Number.isFinite(row.amount) || row.amount <= 0) {
        return NextResponse.json(
          {
            error: "INVARIANT_VIOLATION",
            message: "amount 가 0 이하인 라인이 감지되었습니다.",
            detail: { staff_work_log_id: row.staff_work_log_id, amount: row.amount },
          },
          { status: 500 },
        )
      }
    }

    const { data: insertedItems, error: itemsErr } = await supabase
      .from("cross_store_settlement_items")
      .upsert(itemRows, { onConflict: "staff_work_log_id", ignoreDuplicates: true })
      .select("staff_work_log_id")

    if (itemsErr) {
      return NextResponse.json(
        { error: "ITEMS_INSERT_FAILED", message: "정산 라인 생성 실패", detail: itemsErr.message },
        { status: 500 },
      )
    }

    const insertedLogIds = new Set(
      ((insertedItems ?? []) as Array<{ staff_work_log_id: string | null }>)
        .map((r) => r.staff_work_log_id)
        .filter((v): v is string => !!v),
    )

    // Step 5c: header 크레딧 — 실제 삽입된 라인의 amount 합만 반영.
    //   invariant: header.total_amount(델타) === Σ 실제 삽입된 items.amount.
    const actualTotal = pricedLogs
      .filter((pl) => insertedLogIds.has(pl.log.id))
      .reduce((s, pl) => s + pl.amount, 0)

    if (actualTotal > 0) {
      const { error: creditErr } = await supabase
        .from("cross_store_settlements")
        .update({
          total_amount: headerBaselineTotal + actualTotal,
          remaining_amount: headerBaselineRemaining + actualTotal,
          updated_at: nowIso,
        })
        .eq("id", headerId)
        .eq("store_uuid", fromStore)
        .is("deleted_at", null)
      if (creditErr) {
        return NextResponse.json(
          { error: "HEADER_CREDIT_FAILED", message: "정산 헤더 크레딧 실패", detail: creditErr.message },
          { status: 500 },
        )
      }
    } else if (!headerExisted) {
      // 방금 만든 신규 헤더인데 실제 삽입이 0건 (전부 ON CONFLICT) — 고아 헤더
      //   방지를 위해 soft-delete. totals 는 여전히 0 이므로 돈 손실 없음.
      await supabase
        .from("cross_store_settlements")
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .eq("id", headerId)
        .eq("store_uuid", fromStore)
      continue
    }

    // Step 6: 실제 삽입된 로그만 status='settled' 로 전이.
    //   .eq("status","confirmed") 로 이미 전이된 행 재업데이트 차단.
    const toSettleIds = pricedLogs
      .map((pl) => pl.log.id)
      .filter((id) => insertedLogIds.has(id))

    if (toSettleIds.length > 0) {
      const { error: updErr } = await supabase
        .from("staff_work_logs")
        .update({
          cross_store_settlement_id: headerId,
          status: "settled",
          updated_at: nowIso,
        })
        .in("id", toSettleIds)
        .eq("status", "confirmed")
      if (updErr) {
        return NextResponse.json(
          { error: "LOG_UPDATE_FAILED", message: "로그 상태 업데이트 실패", detail: updErr.message },
          { status: 500 },
        )
      }
      processed += toSettleIds.length
    }
  }

  // ── Step 7: audit_events (fail-close) ───────────────────────
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "staff_work_logs_settled",
    entity_table: "cross_store_settlements",
    entity_id: originStore,
    metadata: {
      count: processed,
      origin_store_uuid: originStore,
      from,
      to,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({
    ok: true,
    processed,
    skipped: skipped.length,
    ...(skipped.length > 0 ? { skipped_details: skipped } : {}),
  })
}
