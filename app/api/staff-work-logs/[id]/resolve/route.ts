import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkResolvable,
  errResp,
  getServiceClient,
} from "@/lib/server/queries/staffWorkLogLifecycle"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/staff-work-logs/[id]/resolve
 *
 * disputed → confirmed 전이 (해결/재확정). Phase 3-A 신규.
 *
 * 정책 (스펙):
 *   - auth.role ∈ {owner, super_admin} 만 허용 (manager 불가)
 *   - row.status === "disputed" 만 허용 (else 409 STATE_CONFLICT)
 *   - row.manager_membership_id !== null 필수 (else 400 MANAGER_REQUIRED)
 *   - non-super_admin 의 경우 row.origin_store_uuid === auth.store_uuid
 *     (else 403 STORE_SCOPE_FORBIDDEN)
 *   - settled → 400 SETTLED_LOCKED (공통)
 *   - voided → 400 INVALID_STATE_TRANSITION (공통)
 *
 * Body:
 *   { reason?: string, memo?: string }  — 모두 선택.
 *   DB 에 dispute_reason 컬럼이 없으므로 resolve 사유는 audit_events 에만
 *   저장된다 (스펙 제약: dispute_reason 컬럼 추가 금지).
 *
 * 동작:
 *   UPDATE staff_work_logs
 *     SET status = 'confirmed',
 *         confirmed_by = auth.user_id,
 *         confirmed_at = now(),
 *         updated_at = now()
 *   WHERE id = :id
 *
 *   audit_events:
 *     action = 'staff_work_log_resolved'
 *     before = { status: 'disputed' }
 *     metadata = { work_log_id, from_status, to_status, manager_membership_id, reason, memo }
 *
 * 주의:
 *   - confirm route (draft → confirmed) 와는 분리된 경로. confirm route
 *     를 disputed 에 호출하면 INVALID_STATE_TRANSITION 으로 차단된다.
 *     감사 로그 action 이 다르므로 의도적 분리.
 *   - settlement / cross_store_settlement / BLE 연결 없음.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "id UUID 형식이 아닙니다." },
      { status: 400 },
    )
  }

  const isOwner = auth.role === "owner"
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "해결(재확정) 권한이 없습니다." },
      { status: 403 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: unknown
    memo?: unknown
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  const memo = typeof body.memo === "string" ? body.memo.trim() : ""

  const { row, error: loadErr } = await loadWorkLog(id)
  if (loadErr) return errResp(loadErr)
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

  const gateErr = checkResolvable(row, auth)
  if (gateErr) return errResp(gateErr)

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("staff_work_logs")
    .update({
      status: "confirmed",
      confirmed_by: auth.user_id,
      confirmed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "재확정 업데이트 실패" },
      { status: 500 },
    )
  }

  const auditFail = await auditOr500(supabase, {
    auth,
    action: "staff_work_log_resolved",
    entity_table: "store_memberships",
    entity_id: row.hostess_membership_id,
    before: { status: "disputed" },
    reason: reason || null,
    metadata: {
      work_log_id: id,
      from_status: "disputed",
      to_status: "confirmed",
      manager_membership_id: row.manager_membership_id,
      reason: reason || null,
      memo: memo || null,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "confirmed" })
}
