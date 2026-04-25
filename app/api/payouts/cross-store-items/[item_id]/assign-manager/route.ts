import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * PATCH /api/payouts/cross-store-items/[item_id]/assign-manager
 *
 * null manager (또는 owner 판단하에 변경 필요한) cross_store_settlement_items
 * 1건의 manager_membership_id 를 보정한다.
 *
 * Phase 10 (2026-04-24) schema-drift fix:
 *   - target_manager_membership_id: 038 에서 items 에서 DROP. UPDATE/SELECT
 *     더 이상 참조하지 않음. 의미적 owner 축은 manager_membership_id 로 단일화.
 *   - cross_store_work_record_id: 075 미적용 → 참조 제거.
 *
 * ⚠️ 원칙:
 *   - owner 또는 super_admin 만 허용.
 *   - item.store_uuid === auth.store_uuid 또는 super_admin 이어야 한다.
 *   - 지정할 manager 는 item.target_store_uuid 소속 + role='manager' + status='approved' +
 *     deleted_at IS NULL 이어야 한다 (receiver 매장의 실장만 수취자로 유효).
 *   - item.paid_amount > 0 이면 재배정 **불가** (이미 돈이 흘러간 상태).
 *   - item.status ∈ {completed, cancelled, closed} 이면 재배정 불가.
 *   - 이 API 는 null manager 가 아닌 item 도 재배정 가능하지만 (owner override),
 *     위 paid/status 가드가 동시에 적용되어 실제로는 안전한 범위만 통과.
 *
 * ⚠️ 금지:
 *   - null manager 를 "임의로 추정 배정" 하지 않는다 — 반드시 operator 가
 *     body.manager_membership_id 를 명시적으로 선택.
 *   - cross_store_work_records 테이블 수정 금지 (manager_membership_id 컬럼
 *     자체가 없음). hostesses.manager_membership_id 도 이 경로에서 수정하지
 *     않는다 — item 한 건 보정만 담당.
 *
 * Body:
 *   { manager_membership_id: uuid }
 *
 * 응답:
 *   { ok: true, item_id, before: { manager_membership_id }, after: { manager_membership_id } }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
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
      { error: "ROLE_FORBIDDEN", message: "실장 배정은 사장/운영자만 수행할 수 있습니다." },
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

  const body = (await request.json().catch(() => ({}))) as { manager_membership_id?: unknown }
  const newManagerId =
    typeof body.manager_membership_id === "string" ? body.manager_membership_id.trim() : ""
  if (!UUID_RE.test(newManagerId)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "manager_membership_id 는 유효한 UUID 여야 합니다." },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()

  const { data: itemRow, error: loadErr } = await supabase
    .from("cross_store_settlement_items")
    .select(
      "id, cross_store_settlement_id, store_uuid, target_store_uuid, manager_membership_id, amount, paid_amount, remaining_amount, status",
    )
    .eq("id", item_id)
    .is("deleted_at", null)
    .maybeSingle()

  if (loadErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "item 조회 실패", detail: loadErr.message },
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
    amount: number | null
    paid_amount: number | null
    remaining_amount: number | null
    status: string | null
  }
  const item = itemRow as unknown as Item

  if (!isSuperAdmin && item.store_uuid !== auth.store_uuid) {
    return NextResponse.json(
      { error: "STORE_SCOPE_FORBIDDEN", message: "본 매장 외 item 은 변경할 수 없습니다." },
      { status: 403 },
    )
  }

  const paid = Number(item.paid_amount ?? 0)
  if (Number.isFinite(paid) && paid > 0) {
    return NextResponse.json(
      {
        error: "PAID_ITEM_FROZEN",
        message: "이미 지급이 발생한 item 은 실장을 재배정할 수 없습니다.",
        paid_amount: paid,
      },
      { status: 409 },
    )
  }
  if (item.status === "completed" || item.status === "cancelled" || item.status === "closed") {
    return NextResponse.json(
      {
        error: "ITEM_LOCKED",
        message: `상태(${item.status}) 의 item 은 실장을 재배정할 수 없습니다.`,
        status: item.status,
      },
      { status: 409 },
    )
  }

  const { data: memRow, error: memErr } = await supabase
    .from("store_memberships")
    .select("id, role, status, store_uuid")
    .eq("id", newManagerId)
    .is("deleted_at", null)
    .maybeSingle()

  if (memErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "manager 멤버십 조회 실패", detail: memErr.message },
      { status: 500 },
    )
  }
  if (!memRow) {
    return NextResponse.json(
      { error: "MANAGER_NOT_FOUND", message: "지정한 실장 멤버십을 찾을 수 없습니다." },
      { status: 404 },
    )
  }
  const mem = memRow as { id: string; role: string; status: string; store_uuid: string }
  if (mem.role !== "manager" || mem.status !== "approved") {
    return NextResponse.json(
      {
        error: "MANAGER_INVALID",
        message: "해당 멤버십이 approved manager 가 아닙니다.",
        role: mem.role,
        status_mem: mem.status,
      },
      { status: 400 },
    )
  }
  if (mem.store_uuid !== item.target_store_uuid) {
    return NextResponse.json(
      {
        error: "MANAGER_STORE_MISMATCH",
        message: "지정한 실장이 수취 매장(origin_store) 소속이 아닙니다.",
        manager_store_uuid: mem.store_uuid,
        target_store_uuid: item.target_store_uuid,
      },
      { status: 400 },
    )
  }

  if (item.manager_membership_id === newManagerId) {
    return NextResponse.json(
      {
        error: "NO_CHANGE",
        message: "이미 동일한 실장이 배정되어 있습니다.",
      },
      { status: 409 },
    )
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await supabase
    .from("cross_store_settlement_items")
    .update({
      manager_membership_id: newManagerId,
      updated_at: nowIso,
    })
    .eq("id", item_id)
    .is("deleted_at", null)

  if (updErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "실장 배정 실패", detail: updErr.message },
      { status: 500 },
    )
  }

  const auditFail = await auditOr500(supabase, {
    auth,
    action: "cross_store_item_manager_assigned",
    entity_table: "cross_store_settlement_items",
    entity_id: item_id,
    before: { manager_membership_id: item.manager_membership_id },
    metadata: {
      item_id,
      cross_store_settlement_id: item.cross_store_settlement_id,
      before_manager: item.manager_membership_id,
      after_manager: newManagerId,
      target_store_uuid: item.target_store_uuid,
      was_null: item.manager_membership_id === null,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({
    ok: true,
    item_id,
    before: { manager_membership_id: item.manager_membership_id },
    after: { manager_membership_id: newManagerId },
  })
}
