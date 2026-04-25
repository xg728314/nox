import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/payouts/cross-store-items/[item_id]/release
 *
 * Phase 10: 실장 정산 인계 회수 (handler 해제).
 *
 * 동작: `current_handler_membership_id = NULL`, `handover_at = NULL`,
 *       `handover_reason = NULL`. owner (manager_membership_id) 는 불변.
 *
 * 권한 (세 중 하나):
 *   1. owner (auth.role === 'owner')
 *   2. super_admin (auth.is_super_admin === true)
 *   3. 현재 handler 본인 — auth.membership_id === current_handler_membership_id
 *
 * scope: non-super_admin 은 items.store_uuid = auth.store_uuid.
 *
 * Body:
 *   { reason?: string }
 *
 * 응답:
 *   { ok, item_id, released_handler }
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

  const { item_id } = await params
  if (!UUID_RE.test(item_id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "item_id UUID 형식이 아닙니다." },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  const supabase = getServiceClient()

  // item 로드
  const { data: itemRow, error: loadErr } = await supabase
    .from("cross_store_settlement_items")
    .select(
      "id, cross_store_settlement_id, store_uuid, manager_membership_id, current_handler_membership_id, handover_at",
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
          message: "current_handler_membership_id 컬럼이 없습니다. migration 077 적용 필요.",
          missing_migration: "077_settlement_handover_foundation.sql",
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
    manager_membership_id: string | null
    current_handler_membership_id: string | null
    handover_at: string | null
  }
  const item = itemRow as unknown as Item

  // 권한: owner / super_admin / handler 본인
  const isOwner = auth.role === "owner"
  const isSuperAdmin = auth.is_super_admin === true
  const isSelfHandler =
    item.current_handler_membership_id !== null &&
    item.current_handler_membership_id === auth.membership_id
  if (!isOwner && !isSuperAdmin && !isSelfHandler) {
    return NextResponse.json(
      {
        error: "ROLE_FORBIDDEN",
        message: "release 권한이 없습니다 (owner / super_admin / 현재 handler 본인만 가능).",
      },
      { status: 403 },
    )
  }
  if (!isSuperAdmin && item.store_uuid !== auth.store_uuid) {
    return NextResponse.json(
      { error: "STORE_SCOPE_FORBIDDEN", message: "본 매장 외 item 은 해제할 수 없습니다." },
      { status: 403 },
    )
  }

  if (item.current_handler_membership_id === null) {
    return NextResponse.json(
      { error: "NOT_HANDED_OVER", message: "현재 인계된 상태가 아닙니다." },
      { status: 409 },
    )
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await supabase
    .from("cross_store_settlement_items")
    .update({
      current_handler_membership_id: null,
      handover_at: null,
      handover_reason: null,
      updated_at: nowIso,
    })
    .eq("id", item_id)
    .is("deleted_at", null)

  if (updErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "release 실패", detail: updErr.message },
      { status: 500 },
    )
  }

  const releasedHandler = item.current_handler_membership_id
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "cssi_release",
    entity_table: "cross_store_settlement_items",
    entity_id: item_id,
    before: {
      current_handler_membership_id: releasedHandler,
      handover_at: item.handover_at,
    },
    reason: reason || null,
    metadata: {
      item_id,
      cross_store_settlement_id: item.cross_store_settlement_id,
      owner_manager_membership_id: item.manager_membership_id,
      released_handler: releasedHandler,
      released_by_role: isSuperAdmin ? "super_admin" : isOwner ? "owner" : "self_handler",
      after: { current_handler_membership_id: null, handover_at: null },
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({
    ok: true,
    item_id,
    released_handler: releasedHandler,
  })
}
