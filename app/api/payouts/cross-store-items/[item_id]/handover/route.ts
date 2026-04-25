import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/payouts/cross-store-items/[item_id]/handover
 *
 * Phase 10: 실장 정산 인계 (handler 지정).
 *
 * ⚠️ owner 와 handler 는 서로 다른 축. 본 route 는 **handler 만** 변경한다.
 *   - owner (manager_membership_id / target_manager_membership_id): 불변.
 *   - handler (current_handler_membership_id): 이 route 가 세팅.
 *
 * 권한: owner 또는 super_admin.
 *   - payer 매장 (items.store_uuid) 기준 scope. non-super_admin 은 본 매장 item 만.
 *
 * 지정 handler 유효성:
 *   - store_memberships 존재 + role='manager' + status='approved' + deleted_at IS NULL.
 *   - handler.store_uuid = items.store_uuid (payer 매장 소속 실장). 타 매장 실장
 *     에게 인계 불허 — 같은 매장 내 인계 전용.
 *   - handler_membership_id ≠ item.manager_membership_id (owner 본인에게 인계 금지).
 *
 * Body:
 *   { handler_membership_id: uuid, reason?: string }
 *
 * 응답:
 *   { ok, item_id, handler_membership_id, handover_at }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  { params }: { params: Promise<{ item_id: string }> },
) {
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
      { error: "ROLE_FORBIDDEN", message: "인계 권한은 사장/운영자만 가능합니다." },
      { status: 403 },
    )
  }

  const { item_id } = await params
  if (!UUID_RE.test(item_id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "item_id UUID 형식이 아닙니다." },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as {
    handler_membership_id?: unknown
    reason?: unknown
  }
  const handlerId =
    typeof body.handler_membership_id === "string" ? body.handler_membership_id.trim() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!UUID_RE.test(handlerId)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "handler_membership_id 는 유효한 UUID 여야 합니다." },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()

  // ── [1] item 로드 ─────────────────────────────────────────
  const { data: itemRow, error: loadErr } = await supabase
    .from("cross_store_settlement_items")
    .select(
      "id, cross_store_settlement_id, store_uuid, target_store_uuid, manager_membership_id, current_handler_membership_id, status, paid_amount",
    )
    .eq("id", item_id)
    .is("deleted_at", null)
    .maybeSingle()

  if (loadErr) {
    const msg = String(loadErr.message ?? "")
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
  if (!itemRow) {
    return NextResponse.json(
      { error: "ITEM_NOT_FOUND", message: "item 을 찾을 수 없습니다." },
      { status: 404 },
    )
  }

  type Item = {
    id: string
    cross_store_settlement_id: string
    store_uuid: string
    target_store_uuid: string
    manager_membership_id: string | null
    current_handler_membership_id: string | null
    status: string | null
    paid_amount: number | null
  }
  const item = itemRow as unknown as Item

  // ── [2] scope 가드 — payer 매장 기준 ─────────────────────
  if (!isSuperAdmin && item.store_uuid !== auth.store_uuid) {
    return NextResponse.json(
      { error: "STORE_SCOPE_FORBIDDEN", message: "본 매장(payer) 외 item 은 인계할 수 없습니다." },
      { status: 403 },
    )
  }

  // ── [3] owner 본인에게 인계 금지 ──────────────────────────
  if (item.manager_membership_id && handlerId === item.manager_membership_id) {
    return NextResponse.json(
      {
        error: "HANDLER_IS_OWNER",
        message: "owner 본인을 handler 로 지정할 수 없습니다. release 로 해제하세요.",
      },
      { status: 400 },
    )
  }

  // ── [4] 지정 handler 유효성 검증 ──────────────────────────
  //   - store_memberships 존재 + manager + approved + 본 매장(payer) 소속.
  const { data: memRow, error: memErr } = await supabase
    .from("store_memberships")
    .select("id, role, status, store_uuid")
    .eq("id", handlerId)
    .is("deleted_at", null)
    .maybeSingle()
  if (memErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "handler 조회 실패", detail: memErr.message },
      { status: 500 },
    )
  }
  if (!memRow) {
    return NextResponse.json(
      { error: "HANDLER_NOT_FOUND", message: "지정한 handler 멤버십을 찾을 수 없습니다." },
      { status: 404 },
    )
  }
  const mem = memRow as { id: string; role: string; status: string; store_uuid: string }
  if (mem.role !== "manager" || mem.status !== "approved") {
    return NextResponse.json(
      {
        error: "HANDLER_INVALID",
        message: "handler 는 approved 상태의 manager 여야 합니다.",
        role: mem.role,
        status_mem: mem.status,
      },
      { status: 400 },
    )
  }
  if (mem.store_uuid !== item.store_uuid) {
    return NextResponse.json(
      {
        error: "HANDLER_STORE_MISMATCH",
        message: "handler 는 payer 매장(items.store_uuid) 소속이어야 합니다.",
        handler_store_uuid: mem.store_uuid,
        item_store_uuid: item.store_uuid,
      },
      { status: 400 },
    )
  }

  if (item.current_handler_membership_id === handlerId) {
    return NextResponse.json(
      { error: "NO_CHANGE", message: "이미 같은 handler 가 지정되어 있습니다." },
      { status: 409 },
    )
  }

  // ── [5] UPDATE — handler / handover_at / reason ──────────
  const nowIso = new Date().toISOString()
  const { error: updErr } = await supabase
    .from("cross_store_settlement_items")
    .update({
      current_handler_membership_id: handlerId,
      handover_at: nowIso,
      handover_reason: reason || null,
      updated_at: nowIso,
    })
    .eq("id", item_id)
    .is("deleted_at", null)

  if (updErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "handover 업데이트 실패", detail: updErr.message },
      { status: 500 },
    )
  }

  // ── [6] audit ─────────────────────────────────────────────
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "cssi_handover",
    entity_table: "cross_store_settlement_items",
    entity_id: item_id,
    before: { current_handler_membership_id: item.current_handler_membership_id },
    reason: reason || null,
    metadata: {
      item_id,
      cross_store_settlement_id: item.cross_store_settlement_id,
      owner_manager_membership_id: item.manager_membership_id,
      from_handler: item.current_handler_membership_id,
      to_handler: handlerId,
      after: { current_handler_membership_id: handlerId, handover_at: nowIso },
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({
    ok: true,
    item_id,
    handler_membership_id: handlerId,
    handover_at: nowIso,
  })
}
