import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkResolvable,
  errResp,
  getServiceClient,
} from "@/lib/server/queries/staff/workLogLifecycle"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/staff-work-logs/[id]/resolve
 *
 * disputed → resolved (cross_store_work_records).
 *
 * ⚠️ 2026-04-24 수정:
 *   실 테이블 cross_store_work_records. manager_membership_id 컬럼 없음 →
 *   "담당 실장 지정 필수" 검증 제거. confirmed_by / confirmed_at 컬럼 없음 →
 *   resolve 시 approved_by / approved_at 를 업데이트 (최종 해결자 기록).
 *
 * 정책:
 *   - auth.role ∈ {owner, super_admin} 만 (manager 불가)
 *   - row.status === "disputed" 만 (else 409 STATE_CONFLICT)
 *   - non-super_admin: origin_store_uuid === auth.store_uuid
 *   - resolved / voided → 400 INVALID_STATE_TRANSITION
 *
 * Body: { reason?: string, memo?: string } — 모두 선택. audit 에만 저장.
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
    .from("cross_store_work_records")
    .update({
      status: "resolved",
      approved_by: auth.membership_id,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: `재확정 업데이트 실패: ${updateErr.message}` },
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
      to_status: "resolved",
      approved_by: auth.membership_id,
      reason: reason || null,
      memo: memo || null,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "resolved" })
}
