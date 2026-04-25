import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkDisputeScopeGate,
  errResp,
  getServiceClient,
} from "@/lib/server/queries/staff/workLogLifecycle"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/staff-work-logs/[id]/dispute
 *
 * confirmed → disputed (cross_store_work_records).
 * 양쪽 매장 (origin / working) caller 허용.
 *
 * ⚠️ 2026-04-24 수정:
 *   실 테이블 cross_store_work_records 에는 manager_membership_id 컬럼 없음.
 *   기존 "manager_membership_id === auth.membership_id" 검증 제거.
 *   manager 경로 권한은 다음으로 재정의:
 *     - store scope: origin_store_uuid OR working_store_uuid === auth.store_uuid
 *     - AND requested_by === auth.membership_id (자기 요청 건만)
 *   owner / super_admin 은 store scope 만 통과하면 허용.
 *
 * Body: { reason: string } — 필수. DB 에 reason 컬럼이 없으므로
 *   audit_events 에만 저장.
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

  const body = (await request.json().catch(() => ({}))) as {
    reason?: unknown; memo?: unknown
  }
  const reason =
    (typeof body.reason === "string" ? body.reason.trim() : "") ||
    (typeof body.memo === "string" ? body.memo.trim() : "")
  if (!reason) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", message: "이의 사유(reason) 가 필요합니다." },
      { status: 400 },
    )
  }

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isManager && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "이의 제기 권한이 없습니다." },
      { status: 403 },
    )
  }

  const { row, error: loadErr } = await loadWorkLog(id)
  if (loadErr) return errResp(loadErr)
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

  const scopeErr = checkDisputeScopeGate(row, auth)
  if (scopeErr) return errResp(scopeErr)

  if (row.status !== "confirmed") {
    return NextResponse.json(
      {
        error: "INVALID_STATE_TRANSITION",
        message: `현재 상태(${row.status}) 에서는 dispute 할 수 없습니다. confirmed 만 가능합니다.`,
      },
      { status: 400 },
    )
  }

  // manager 의 경우: store scope 통과 + 자기 요청 건만.
  //   manager_membership_id 컬럼 제거 대체로 requested_by 기준.
  if (isManager && !isOwner && !isSuperAdmin) {
    if (row.requested_by !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ASSIGNMENT_FORBIDDEN",
          message: "자기가 요청한 로그만 이의 제기할 수 있습니다.",
        },
        { status: 403 },
      )
    }
  }

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("cross_store_work_records")
    .update({
      status: "disputed",
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: `이의 처리 실패: ${updateErr.message}` },
      { status: 500 },
    )
  }

  const auditFail = await auditOr500(supabase, {
    auth,
    action: "staff_work_log_disputed",
    entity_table: "store_memberships",
    entity_id: row.hostess_membership_id,
    before: { status: row.status },
    reason,
    metadata: {
      work_log_id: id,
      from_status: row.status,
      to_status: "disputed",
      requested_by: row.requested_by,
      approved_by: row.approved_by,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "disputed" })
}
