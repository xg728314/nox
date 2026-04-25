import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-043 + 2026-04-24 round: Settlement-tree manager prepayment ledger.
 *
 *   POST /api/payouts/manager-prepayment
 *     Body: { target_store_uuid, target_manager_membership_id,
 *             amount, memo?, business_day_id? }
 *     Returns { ok, id, manager_prepaid, store_prepaid, item_remaining?, ... }.
 *
 *   GET  /api/payouts/manager-prepayment
 *        ?counterpart_store_uuid=...[&manager_membership_id=...]
 *     Active prepayment rows scoped to caller + counterpart.
 *
 * Intra-store (2026-04-24 추가):
 *   target_store_uuid === auth.store_uuid 인 경우 "본 매장 실장 선지급" 으로
 *   처리. cross-store ledger (cross_store_settlements / items) 가 존재하지
 *   않는 축이라 cap 검증을 건너뛴다. manager 가 approved + 본 매장 소속
 *   manager 인지만 검증한 뒤 단순 insert. 응답 `cap_basis: "intra_store_no_cap"`.
 *
 * 상한 검증 (cross-store 만):
 *   1) session_participants 기반 cap (legacy) — aggregate 전 근무기록만 있을 때도
 *      선지급 가능하도록 유지. 본 매장(auth.store_uuid) 가 워킹매장이고
 *      counterpart 가 origin 인 경우의 payout 의무 합.
 *   2) cross_store_settlement_items.remaining_amount 기반 cap (신규) —
 *      aggregate 로 item 이 생성된 이후엔 ledger 가 진실. 동일 manager 에
 *      대한 Σ remaining_amount 이 선지급 가능 상한.
 *   최종 허용치 = min(legacy cap, item cap) 이되, item 이 하나라도 있으면
 *   item cap 을 권위 기준으로 사용. item 0건이면 legacy cap fallback.
 *
 * null manager 정책:
 *   - target_manager_membership_id 는 POST body 에서 필수. null 불허.
 *   - item 의 manager_membership_id 가 null 인 라인은 prepayment 상한 계산에서
 *     제외 (별도 bucket). null manager 는 owner 보정 전에는 선지급 불가.
 *
 * Access: owner + manager (hostess blocked).
 */

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

type ParticipantRow = {
  manager_membership_id: string | null
  origin_store_uuid: string | null
  store_uuid: string
  hostess_payout_amount: number
  role: string
  status: string
}

/**
 * Compute outstanding debt owed by `auth.store_uuid` to managers at
 * `counterpart_store_uuid`, grouped by manager. Same semantics as
 * settlement-tree-operational Level 2 Outbound (external hostesses who
 * worked at our store — we owe their origin-store managers).
 */
async function computeOperationalManagerTotals(
  supabase: SupabaseClient,
  store_uuid: string,
  counterpart_store_uuid: string,
): Promise<Map<string, number>> {
  // Rows where the hostess ORIGINATES FROM counterpart, WORKED AT us.
  // These rows represent an obligation from us → counterpart manager.
  const { data: rows } = await supabase
    .from("session_participants")
    .select("manager_membership_id, origin_store_uuid, store_uuid, hostess_payout_amount, role, status")
    .eq("origin_store_uuid", counterpart_store_uuid)
    .eq("store_uuid", store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  const totals = new Map<string, number>()
  for (const r of (rows ?? []) as ParticipantRow[]) {
    if (r.status !== "active" && r.status !== "left") continue
    const mid = r.manager_membership_id
    if (!mid) continue
    totals.set(mid, (totals.get(mid) ?? 0) + num(r.hostess_payout_amount))
  }
  return totals
}

/**
 * cross_store_settlement_items 기반 remaining_amount 권위 잔액 (신규).
 *   direction:
 *     header.from_store_uuid = store_uuid (우리 — 지불자)
 *     header.to_store_uuid   = counterpart_store_uuid (수취자)
 *   items: manager_membership_id 별 Σ remaining_amount.
 *   null manager 라인은 제외 (별도 bucket, 선지급 불가).
 *
 * 반환:
 *   byManager    manager_membership_id → Σ remaining
 *   total        Σ manager 별 remaining (null manager 제외)
 *   unassigned   null manager 라인의 Σ remaining (관찰용)
 *   itemCount    null 제외 item 수
 */
async function computeItemRemaining(
  supabase: SupabaseClient,
  store_uuid: string,
  counterpart_store_uuid: string,
): Promise<{
  byManager: Map<string, number>
  total: number
  unassigned: number
  itemCount: number
}> {
  // 1) 해당 방향의 open/partial header id 수집
  const { data: headers } = await supabase
    .from("cross_store_settlements")
    .select("id")
    .eq("from_store_uuid", store_uuid)
    .eq("to_store_uuid", counterpart_store_uuid)
    .in("status", ["open", "partial"])
    .is("deleted_at", null)

  const headerIds = ((headers ?? []) as Array<{ id: string }>).map((h) => h.id)
  const byManager = new Map<string, number>()
  if (headerIds.length === 0) {
    return { byManager, total: 0, unassigned: 0, itemCount: 0 }
  }

  // 2) 해당 header 의 items remaining_amount 집계
  const { data: items } = await supabase
    .from("cross_store_settlement_items")
    .select("manager_membership_id, remaining_amount, status")
    .in("cross_store_settlement_id", headerIds)
    .is("deleted_at", null)

  let total = 0
  let unassigned = 0
  let itemCount = 0
  for (const r of (items ?? []) as Array<{
    manager_membership_id: string | null
    remaining_amount: number | null
    status: string | null
  }>) {
    // 종결 상태 제외
    if (r.status === "completed" || r.status === "closed" || r.status === "cancelled") continue
    const rem = num(r.remaining_amount)
    if (!(rem > 0)) continue
    if (!r.manager_membership_id) {
      unassigned += rem
      continue
    }
    itemCount += 1
    total += rem
    byManager.set(
      r.manager_membership_id,
      (byManager.get(r.manager_membership_id) ?? 0) + rem,
    )
  }
  return { byManager, total, unassigned, itemCount }
}

async function computeExistingPrepaid(
  supabase: SupabaseClient,
  store_uuid: string,
  counterpart_store_uuid: string,
): Promise<{ byManager: Map<string, number>; total: number }> {
  const { data: rows } = await supabase
    .from("manager_prepayments")
    .select("target_manager_membership_id, amount")
    .eq("store_uuid", store_uuid)
    .eq("target_store_uuid", counterpart_store_uuid)
    .eq("status", "active")
    .is("deleted_at", null)

  const byManager = new Map<string, number>()
  let total = 0
  for (const r of (rows ?? []) as { target_manager_membership_id: string; amount: number }[]) {
    const a = num(r.amount)
    total += a
    byManager.set(
      r.target_manager_membership_id,
      (byManager.get(r.target_manager_membership_id) ?? 0) + a,
    )
  }
  return { byManager, total }
}

// ── POST ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner / manager can record a prepayment." },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const target_store_uuid = typeof body.target_store_uuid === "string" ? body.target_store_uuid : ""
    const target_manager_membership_id =
      typeof body.target_manager_membership_id === "string" ? body.target_manager_membership_id : ""
    const amount = num(body.amount)
    const memo = typeof body.memo === "string" && body.memo.trim().length > 0 ? body.memo.trim() : null
    const business_day_id =
      typeof body.business_day_id === "string" && body.business_day_id.length > 0
        ? body.business_day_id
        : null
    // Phase 10: 실행자 membership. 지정되지 않으면 caller 본인으로 기본.
    //   target_manager_membership_id (owner) 와 별개 축.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const executorRaw =
      typeof body.executor_membership_id === "string" ? body.executor_membership_id.trim() : ""
    if (executorRaw && !UUID_RE.test(executorRaw)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "executor_membership_id must be a valid uuid." },
        { status: 400 },
      )
    }
    const executor_membership_id = executorRaw || auth.membership_id

    if (!target_store_uuid) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_store_uuid is required." }, { status: 400 })
    }
    if (!target_manager_membership_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_manager_membership_id is required." }, { status: 400 })
    }
    // 2026-04-24: 기존엔 cross-store only (target !== auth.store_uuid) 로 제한했으나
    //   운영 요구상 같은 매장 실장 선지급도 허용. intra-store 분기에서는 cross-store
    //   ledger 기반 cap (cross_store_settlements / cross_store_settlement_items) 이
    //   의미가 없으므로 caps 계산을 건너뛴다. manager 유효성만 확인.
    const isIntraStore = target_store_uuid === auth.store_uuid
    if (!(amount > 0) || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be a finite positive number." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Closed-day guard when business_day_id supplied.
    if (business_day_id) {
      const guard = await assertBusinessDayOpen(supabase, business_day_id)
      if (guard) return guard
    }

    // ── Intra-store short-circuit ─────────────────────────────────────
    //   cross-store ledger 기반 cap 계산이 무의미. manager 가 본 매장 approved
    //   manager 인지 정도만 확인하고 바로 insert.
    if (isIntraStore) {
      const { data: mgrMem } = await supabase
        .from("store_memberships")
        .select("id, role, status")
        .eq("id", target_manager_membership_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!mgrMem) {
        return NextResponse.json(
          { error: "MANAGER_NOT_FOUND", message: "해당 실장 멤버십을 본 매장에서 찾을 수 없습니다." },
          { status: 404 },
        )
      }
      const mm = mgrMem as { id: string; role: string; status: string }
      if (mm.role !== "manager" || mm.status !== "approved") {
        return NextResponse.json(
          {
            error: "MANAGER_INVALID",
            message: "approved 상태의 manager 멤버십이 아닙니다.",
            role: mm.role,
            status_mem: mm.status,
          },
          { status: 400 },
        )
      }

      // Phase 10.1 안전화: 077 미적용 DB 에서 executor_membership_id 컬럼이
      //   없어 INSERT 가 23703 (column does not exist) 으로 터지면 해당 필드
      //   없이 재시도. 기존 금액/제약 로직 불변. intra-store CHECK
      //   (store_uuid <> target_store_uuid) 는 본 intra 분기 진입 전에 이미
      //   pass 가정 안 되므로 — 이 블록은 사실 cross-store 경로에서만
      //   도달하나, 안전 fallback 은 intra/cross 모두 동일 패턴 사용.
      const baseInsertIntra: Record<string, unknown> = {
        store_uuid: auth.store_uuid,
        target_store_uuid,
        target_manager_membership_id,
        business_day_id,
        amount,
        memo,
        status: "active",
        created_by: auth.user_id,
      }
      type InsertedRow = { id: string; amount: number; created_at: string }
      type MaybeErr = { message?: string; code?: string } | null
      let inserted: InsertedRow | null = null
      let insErr: MaybeErr = null
      {
        const r = await supabase
          .from("manager_prepayments")
          .insert({ ...baseInsertIntra, executor_membership_id })
          .select("id, amount, created_at")
          .single()
        inserted = (r.data as unknown as InsertedRow | null) ?? null
        insErr = (r.error as unknown as MaybeErr) ?? null
      }
      if (
        insErr &&
        /column .*executor_membership_id.* does not exist/i.test(String(insErr.message ?? ""))
      ) {
        const r2 = await supabase
          .from("manager_prepayments")
          .insert(baseInsertIntra)
          .select("id, amount, created_at")
          .single()
        inserted = (r2.data as unknown as InsertedRow | null) ?? null
        insErr = (r2.error as unknown as MaybeErr) ?? null
      }
      if (insErr || !inserted) {
        return NextResponse.json(
          { error: "INSERT_FAILED", message: insErr?.message || "Failed to record prepayment." },
          { status: 500 },
        )
      }
      try {
        await supabase.from("audit_events").insert({
          store_uuid: auth.store_uuid,
          actor_user_id: auth.user_id,
          actor_role: auth.role,
          actor_type: auth.role,
          entity_table: "manager_prepayments",
          entity_id: inserted.id,
          action: "manager_prepayment_created",
          after: {
            target_store_uuid,
            target_manager_membership_id,
            amount,
            business_day_id,
            intra_store: true,
            executor_membership_id,
          },
        })
      } catch { /* non-blocking */ }

      return NextResponse.json({
        ok: true,
        id: inserted.id,
        created_at: inserted.created_at,
        intra_store: true,
        cap_basis: "intra_store_no_cap",
        // cross-store 전용 field 들은 0 또는 undefined. 호환 위해 key 유지.
        manager_total: 0,
        manager_prepaid: amount,
        manager_remaining: 0,
        store_total: 0,
        store_prepaid: amount,
        store_remaining: 0,
      })
    }

    // Recompute caps.
    //   (a) legacy session_participants cap (aggregate 이전 선지급 허용용)
    //   (b) cross_store_settlement_items.remaining_amount cap (ledger 권위)
    const managerTotals = await computeOperationalManagerTotals(
      supabase,
      auth.store_uuid,
      target_store_uuid,
    )
    const storeTotalLegacy = Array.from(managerTotals.values()).reduce((s, v) => s + v, 0)

    const { byManager: prepaidByMgr, total: prepaidStoreTotal } =
      await computeExistingPrepaid(supabase, auth.store_uuid, target_store_uuid)

    const itemRem = await computeItemRemaining(
      supabase,
      auth.store_uuid,
      target_store_uuid,
    )

    const thisManagerLegacyTotal = managerTotals.get(target_manager_membership_id) ?? 0
    const thisManagerPrepaid = prepaidByMgr.get(target_manager_membership_id) ?? 0
    const legacyManagerRemaining = thisManagerLegacyTotal - thisManagerPrepaid
    const legacyStoreRemaining = storeTotalLegacy - prepaidStoreTotal

    const itemManagerRemaining = itemRem.byManager.get(target_manager_membership_id) ?? 0
    const hasAnyItemsForThisManager = itemRem.byManager.has(target_manager_membership_id)
    const hasAnyItems = itemRem.itemCount > 0

    // 권위 순위: item 이 존재하면 item remaining 을 cap 으로 사용.
    //   item 존재 + 본 manager 라인 0건 → 0 cap (ledger 로는 지불 의무 없음).
    //   item 전무 → legacy cap 만 사용.
    const authoritativeManagerCap = hasAnyItems
      ? itemManagerRemaining
      : legacyManagerRemaining
    const authoritativeStoreCap = hasAnyItems
      ? itemRem.total
      : legacyStoreRemaining

    if (hasAnyItems && !hasAnyItemsForThisManager) {
      return NextResponse.json(
        {
          error: "MANAGER_NO_ITEMS",
          message:
            "해당 실장에 대한 정산 item 이 없습니다. aggregate 로 item 이 생성된 뒤 선지급 가능합니다.",
          item_manager_remaining: 0,
          item_count_total: itemRem.itemCount,
          unassigned_remaining: itemRem.unassigned,
        },
        { status: 409 },
      )
    }

    if (amount > authoritativeManagerCap) {
      return NextResponse.json(
        {
          error: "MANAGER_OVERPAY",
          message: "실장 잔액을 초과하는 선지급은 허용되지 않습니다.",
          manager_total: thisManagerLegacyTotal,
          manager_prepaid: thisManagerPrepaid,
          manager_remaining: authoritativeManagerCap,
          cap_basis: hasAnyItems ? "item_remaining" : "session_participants_legacy",
          item_manager_remaining: itemManagerRemaining,
          legacy_manager_remaining: legacyManagerRemaining,
        },
        { status: 409 },
      )
    }
    if (amount > authoritativeStoreCap) {
      return NextResponse.json(
        {
          error: "STORE_OVERPAY",
          message: "가게 총 잔액을 초과하는 선지급은 허용되지 않습니다.",
          store_total: storeTotalLegacy,
          store_prepaid: prepaidStoreTotal,
          store_remaining: authoritativeStoreCap,
          cap_basis: hasAnyItems ? "item_remaining" : "session_participants_legacy",
          item_store_remaining: itemRem.total,
          legacy_store_remaining: legacyStoreRemaining,
          unassigned_remaining: itemRem.unassigned,
        },
        { status: 409 },
      )
    }

    // Insert ledger row. Phase 10.1: 077 미적용 DB 에서 executor 컬럼 부재 시
    //   해당 필드 없이 재시도 (fallback).
    const baseInsertCross: Record<string, unknown> = {
      store_uuid: auth.store_uuid,
      target_store_uuid,
      target_manager_membership_id,
      business_day_id,
      amount,
      memo,
      status: "active",
      created_by: auth.user_id,
    }
    type InsertedRow = { id: string; amount: number; created_at: string }
    type MaybeErr = { message?: string; code?: string } | null
    let inserted: InsertedRow | null = null
    let insErr: MaybeErr = null
    {
      const r = await supabase
        .from("manager_prepayments")
        .insert({ ...baseInsertCross, executor_membership_id })
        .select("id, amount, created_at")
        .single()
      inserted = (r.data as unknown as InsertedRow | null) ?? null
      insErr = (r.error as unknown as MaybeErr) ?? null
    }
    if (
      insErr &&
      /column .*executor_membership_id.* does not exist/i.test(String(insErr.message ?? ""))
    ) {
      const r2 = await supabase
        .from("manager_prepayments")
        .insert(baseInsertCross)
        .select("id, amount, created_at")
        .single()
      inserted = (r2.data as unknown as InsertedRow | null) ?? null
      insErr = (r2.error as unknown as MaybeErr) ?? null
    }

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: "INSERT_FAILED", message: insErr?.message || "Failed to record prepayment." },
        { status: 500 }
      )
    }

    // Audit log — best-effort (do not fail the request on audit write error).
    try {
      await supabase.from("audit_events").insert({
        store_uuid: auth.store_uuid,
        actor_user_id: auth.user_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "manager_prepayments",
        entity_id: inserted.id,
        action: "manager_prepayment_created",
        after: {
          target_store_uuid,
          target_manager_membership_id,
          amount,
          business_day_id,
          executor_membership_id,
        },
      })
    } catch {
      /* audit write failure is non-blocking */
    }

    return NextResponse.json({
      ok: true,
      id: inserted.id,
      created_at: inserted.created_at,
      cap_basis: hasAnyItems ? "item_remaining" : "session_participants_legacy",
      manager_total: thisManagerLegacyTotal,
      manager_prepaid: thisManagerPrepaid + amount,
      manager_remaining: authoritativeManagerCap - amount,
      store_total: storeTotalLegacy,
      store_prepaid: prepaidStoreTotal + amount,
      store_remaining: authoritativeStoreCap - amount,
      item_manager_remaining: itemManagerRemaining,
      item_store_remaining: itemRem.total,
      unassigned_remaining: itemRem.unassigned,
    })
  } catch (error) {
    return handleRouteError(error, "payouts/manager-prepayment")
  }
}

// ── GET ────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const counterpart = url.searchParams.get("counterpart_store_uuid")
    const manager = url.searchParams.get("manager_membership_id")
    const businessDayId = url.searchParams.get("business_day_id")

    if (!counterpart) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "counterpart_store_uuid is required." },
        { status: 400 }
      )
    }

    // Phase 10 (2026-04-24): 081 이후 manager_prepayments 는 intra-store
    //   row 도 허용하나, 본 GET 은 "타매장 선지급 원장" 조회 용도 → self
    //   counterpart 는 cross-store 의미와 어긋남. 명시 거부.
    if (counterpart === auth.store_uuid) {
      return NextResponse.json(
        {
          error: "INVALID_COUNTERPART",
          message: "counterpart_store_uuid 는 본 매장과 달라야 합니다.",
        },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    let q = supabase
      .from("manager_prepayments")
      .select("id, target_manager_membership_id, amount, memo, business_day_id, status, created_at, created_by")
      .eq("store_uuid", auth.store_uuid)
      .eq("target_store_uuid", counterpart)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (manager) q = q.eq("target_manager_membership_id", manager)
    if (businessDayId) q = q.eq("business_day_id", businessDayId)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({
      store_uuid: auth.store_uuid,
      counterpart_store_uuid: counterpart,
      prepayments: data ?? [],
    })
  } catch (error) {
    return handleRouteError(error, "payouts/manager-prepayment")
  }
}
