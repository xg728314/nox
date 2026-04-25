import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/payouts/cross-store-items
 *
 * 미배정(또는 특정 manager) cross_store_settlement_items 목록을 반환한다.
 * Bulk 실장 배정 UX 에서 사용될 데이터 소스.
 *
 * ⚠️ 원칙:
 *   - owner / super_admin 만 허용.
 *   - 본 API 는 **조회 전용**. mutation 없음.
 *   - API 추가이며 기존 payout/RPC/aggregate 경로는 변경하지 않는다.
 *
 * Query params:
 *   unassigned=1                  (optional) manager_membership_id IS NULL 만.
 *   counterpart_store_uuid=...    (optional) header.to_store_uuid 일치.
 *   manager_membership_id=...     (optional) item.manager_membership_id 일치 (owner 축).
 *   handled_by=<uuid>             (optional) current_handler_membership_id 일치 (handler 축).
 *                                 Phase 10 handover 기능 — "내가 handler 로 잡은 item" 조회.
 *   limit=N                       (optional, default 100, max 500)
 *
 * Scope:
 *   - non-super_admin: header.from_store_uuid = auth.store_uuid 인 row 만.
 *   - super_admin:     제약 없음 (counterpart_store_uuid 로 좁히길 권장).
 *
 * 조회 조건 (기본):
 *   - item.deleted_at IS NULL
 *   - item.status IN ('open','partial')
 *     ↑ Phase 10 (2026-04-24) schema-drift fix: live chk_csi_status 는
 *       {'open','partial','completed'} 만 허용. 과거 'pending' literal 제거.
 *
 * 응답:
 *   {
 *     items: [{
 *       id, cross_store_settlement_id,
 *       store_uuid, target_store_uuid, target_store_name,
 *       manager_membership_id,
 *       current_handler_membership_id, handover_at,   -- 077 적용 시 채움
 *       amount, paid_amount, remaining_amount, status, reassignable,
 *     }],
 *     counts: { total, unassigned, reassignable },
 *   }
 *
 *   `reassignable` = paid_amount === 0 AND status ∈ ('open','partial').
 *   Bulk assign UI 는 reassignable=false 인 row 의 체크박스를 비활성화한다.
 *
 * ⚠️ 제거된 필드 (2026-04-24):
 *   - cross_store_work_record_id (migration 075 미적용)
 *   - hostess_membership_id / hostess_name (migration 060 미적용)
 *   → 075 / 060 이 live DB 에 apply 되면 같은 라운드에서 복원 권장.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

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
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "조회 권한이 없습니다." },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const unassignedOnly = url.searchParams.get("unassigned") === "1"
  const counterpart = url.searchParams.get("counterpart_store_uuid") ?? ""
  const managerFilter = url.searchParams.get("manager_membership_id") ?? ""
  const handledByFilter = url.searchParams.get("handled_by") ?? ""
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : DEFAULT_LIMIT

  if (counterpart && !UUID_RE.test(counterpart)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "counterpart_store_uuid UUID 형식 오류" },
      { status: 400 },
    )
  }
  if (managerFilter && !UUID_RE.test(managerFilter)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "manager_membership_id UUID 형식 오류" },
      { status: 400 },
    )
  }
  if (handledByFilter && !UUID_RE.test(handledByFilter)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "handled_by UUID 형식 오류" },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()

  // ── [1] headers 스코프 계산 ────────────────────────────────
  //   non-super_admin: from_store_uuid = auth.store_uuid 고정
  //   super_admin   : 선택적 counterpart 만 필터
  let headerQ = supabase
    .from("cross_store_settlements")
    .select("id, to_store_uuid, from_store_uuid")
    .is("deleted_at", null)

  if (!isSuperAdmin) {
    headerQ = headerQ.eq("from_store_uuid", auth.store_uuid)
  }
  if (counterpart) {
    headerQ = headerQ.eq("to_store_uuid", counterpart)
  }

  const { data: headersRaw, error: hErr } = await headerQ
  if (hErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "헤더 조회 실패", detail: hErr.message },
      { status: 500 },
    )
  }
  const headers = (headersRaw ?? []) as Array<{
    id: string
    to_store_uuid: string
    from_store_uuid: string
  }>

  if (headers.length === 0) {
    return NextResponse.json({
      items: [],
      counts: { total: 0, unassigned: 0, reassignable: 0 },
    })
  }

  const headerIds = headers.map((h) => h.id)
  const toStoreByHeader = new Map(headers.map((h) => [h.id, h.to_store_uuid]))

  // ── [2] items 조회 ────────────────────────────────────────
  let itemQ = supabase
    .from("cross_store_settlement_items")
    .select(
      "id, cross_store_settlement_id, store_uuid, target_store_uuid, manager_membership_id, current_handler_membership_id, handover_at, amount, paid_amount, remaining_amount, status, created_at",
    )
    .in("cross_store_settlement_id", headerIds)
    .is("deleted_at", null)
    .in("status", ["open", "partial"])
    .order("created_at", { ascending: true })
    .limit(limit)

  if (unassignedOnly) {
    itemQ = itemQ.is("manager_membership_id", null)
  }
  if (managerFilter) {
    itemQ = itemQ.eq("manager_membership_id", managerFilter)
  }
  if (handledByFilter) {
    // handler 축. owner (manager_membership_id) 와 독립.
    itemQ = itemQ.eq("current_handler_membership_id", handledByFilter)
  }

  const { data: itemsRaw, error: iErr } = await itemQ
  if (iErr) {
    const msg = String(iErr.message ?? "")
    // migration 077 미적용 감지 (handler 축)
    if (/column .*current_handler_membership_id.* does not exist/i.test(msg)) {
      return NextResponse.json(
        {
          error: "MIGRATION_REQUIRED",
          message:
            "current_handler_membership_id 컬럼이 없습니다. migration 077 적용 필요.",
          missing_migration: "077_settlement_handover_foundation.sql",
          detail: msg,
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "item 조회 실패", detail: msg },
      { status: 500 },
    )
  }

  type RawItem = {
    id: string
    cross_store_settlement_id: string
    store_uuid: string
    target_store_uuid: string
    manager_membership_id: string | null
    current_handler_membership_id: string | null
    handover_at: string | null
    amount: number | null
    paid_amount: number | null
    remaining_amount: number | null
    status: string | null
  }
  const items = (itemsRaw ?? []) as unknown as RawItem[]

  if (items.length === 0) {
    return NextResponse.json({
      items: [],
      counts: { total: 0, unassigned: 0, reassignable: 0 },
    })
  }

  // ── [3] hostess 이름 enrichment — 제거 (2026-04-24)
  //   items.hostess_membership_id 컬럼이 live DB 에 없음 (060 미적용).
  //   060 apply 이후 복원.

  // ── [4] target store 이름 enrichment ───────────────────────
  const toStoreIds = [...new Set(items.map((r) => r.target_store_uuid))]
  const storeNameMap = new Map<string, string>()
  if (toStoreIds.length > 0) {
    const { data: sts } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", toStoreIds)
    for (const s of (sts ?? []) as Array<{ id: string; store_name: string }>) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  // ── [5] shape + counts ─────────────────────────────────────
  let unassignedCount = 0
  let reassignableCount = 0
  const out = items.map((r) => {
    const paid = Number(r.paid_amount ?? 0)
    const paidSafe = Number.isFinite(paid) ? paid : 0
    const reassignable =
      paidSafe === 0 && (r.status === "open" || r.status === "partial")
    if (reassignable) reassignableCount += 1
    if (!r.manager_membership_id) unassignedCount += 1
    return {
      id: r.id,
      cross_store_settlement_id: r.cross_store_settlement_id,
      store_uuid: r.store_uuid,
      target_store_uuid: r.target_store_uuid,
      target_store_name:
        storeNameMap.get(r.target_store_uuid) ??
        toStoreByHeader.get(r.cross_store_settlement_id)?.slice(0, 8) ??
        "",
      manager_membership_id: r.manager_membership_id,
      // Phase 10 handover 필드 (077 적용 시 채움).
      current_handler_membership_id: r.current_handler_membership_id,
      handover_at: r.handover_at,
      amount: Number(r.amount ?? 0),
      paid_amount: paidSafe,
      remaining_amount: Number(r.remaining_amount ?? 0),
      status: r.status,
      reassignable,
    }
  })

  return NextResponse.json({
    items: out,
    counts: {
      total: out.length,
      unassigned: unassignedCount,
      reassignable: reassignableCount,
    },
  })
}
