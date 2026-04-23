import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * PATCH /api/hostesses/[membership_id]/assign
 *
 * Change a hostess's assigned manager (`hostesses.manager_membership_id`).
 *
 * Body:
 *   { manager_membership_id: <uuid> | null }
 *
 * Authorization matrix:
 *   - super_admin                → any manager in the hostess's store, any store
 *   - role === "owner"           → any manager in caller.store_uuid
 *                                  (can also unassign with null)
 *   - role === "manager"         → can ONLY self-assign
 *                                  (value must equal auth.membership_id
 *                                   or null for self-unassign)
 *   - other roles / unauth       → 403
 *
 * The param `membership_id` identifies the hostess row via
 * `hostesses.membership_id` (which FKs to store_memberships.id). The
 * hostess's `store_uuid` is verified against the caller's store for
 * non-super_admin callers to prevent cross-store re-assignment.
 *
 * Side effects:
 *   - UPDATE hostesses SET manager_membership_id = <value>
 *   - INSERT audit_events (action="hostess_assigned", before=prev,
 *     metadata={target_membership_id, from, to, store_uuid})
 *
 * No DB schema change, no store_memberships mutation, no approvals
 * flow change.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> },
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

  const { membership_id: targetMembershipId } = await params
  if (!UUID_RE.test(targetMembershipId)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "membership_id UUID 형식이 아닙니다." },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as {
    manager_membership_id?: unknown
  }
  const raw = body.manager_membership_id
  const nextManagerId: string | null =
    raw === null ? null : typeof raw === "string" ? raw : ""
  if (raw !== null && typeof raw !== "string") {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "manager_membership_id must be string or null" },
      { status: 400 },
    )
  }
  if (typeof raw === "string" && !UUID_RE.test(raw)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "manager_membership_id UUID 형식이 아닙니다." },
      { status: 400 },
    )
  }

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true

  // Coarse caller role gate.
  if (!isOwner && !isManager && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "배정 권한이 없습니다." },
      { status: 403 },
    )
  }

  // Manager (not owner/super_admin) may only self-assign or self-unassign.
  if (isManager && !isOwner && !isSuperAdmin) {
    if (nextManagerId !== null && nextManagerId !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ROLE_FORBIDDEN",
          message: "실장은 본인에게만 배정할 수 있습니다.",
        },
        { status: 403 },
      )
    }
  }

  const supabase = getServiceClient()

  // Fetch target hostess + resolve store scope.
  const { data: hostessRow, error: hErr } = await supabase
    .from("hostesses")
    .select("id, store_uuid, membership_id, manager_membership_id")
    .eq("membership_id", targetMembershipId)
    .is("deleted_at", null)
    .maybeSingle()

  if (hErr) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "아가씨 조회에 실패했습니다." },
      { status: 500 },
    )
  }
  if (!hostessRow) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "아가씨 레코드를 찾을 수 없습니다." },
      { status: 404 },
    )
  }

  // Non-super_admin must operate within own store.
  if (!isSuperAdmin && hostessRow.store_uuid !== auth.store_uuid) {
    return NextResponse.json(
      {
        error: "STORE_SCOPE_FORBIDDEN",
        message: "본인 매장 외 아가씨는 배정할 수 없습니다.",
      },
      { status: 403 },
    )
  }

  // T3-A: manager 는 본인 담당 hostess 만 변경 가능.
  //   위의 초기 body-level 체크(self-assign-only)는 "B 에게 넘기지
  //   못한다" 만 보장했을 뿐, **타 실장이 이미 담당 중인 hostess 를
  //   null 로 해제** 하는 경로는 허용되고 있었다 (T3 remaining risks #1).
  //   hostessRow 를 조회한 뒤, manager 가 자기 것이 아닌 row 를
  //   건드리려 하면 403. owner / super_admin 은 영향 없음.
  if (isManager && !isOwner && !isSuperAdmin) {
    const currentAssignee = (hostessRow.manager_membership_id as string | null) ?? null
    if (currentAssignee !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ROLE_FORBIDDEN",
          message: "본인 담당만 변경할 수 있습니다.",
        },
        { status: 403 },
      )
    }
  }

  // Assign path (not unassign): verify target manager is a real manager
  // in the hostess's store.
  if (nextManagerId !== null) {
    const { data: mgrRow } = await supabase
      .from("store_memberships")
      .select("id, role, status, store_uuid")
      .eq("id", nextManagerId)
      .is("deleted_at", null)
      .maybeSingle()
    if (
      !mgrRow ||
      mgrRow.role !== "manager" ||
      mgrRow.status !== "approved" ||
      mgrRow.store_uuid !== hostessRow.store_uuid
    ) {
      return NextResponse.json(
        {
          error: "MANAGER_INVALID",
          message: "대상 실장 계정이 유효하지 않습니다.",
        },
        { status: 400 },
      )
    }
  }

  const previousManagerId = (hostessRow.manager_membership_id as string | null) ?? null

  // No-op short-circuit (same value). Still write an audit line? No —
  // skip silently to avoid noise.
  if (previousManagerId === nextManagerId) {
    return NextResponse.json({ ok: true, unchanged: true })
  }

  // UPDATE.
  const { error: updateErr } = await supabase
    .from("hostesses")
    .update({
      manager_membership_id: nextManagerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", hostessRow.id)
    .eq("store_uuid", hostessRow.store_uuid as string)
    .is("deleted_at", null)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "배정 업데이트에 실패했습니다." },
      { status: 500 },
    )
  }

  // Audit — fail-close (ROUND-A). 실패 시 500 AUDIT_WRITE_FAILED.
  const auditFail = await auditOr500(supabase, {
    auth,
    action: "hostess_assigned",
    entity_table: "store_memberships",
    entity_id: targetMembershipId,
    before: { manager_membership_id: previousManagerId },
    metadata: {
      target_membership_id: targetMembershipId,
      from_manager_membership_id: previousManagerId,
      to_manager_membership_id: nextManagerId,
      store_uuid: hostessRow.store_uuid as string,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true })
}
