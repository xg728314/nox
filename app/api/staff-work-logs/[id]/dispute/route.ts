import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkBaseLifecycleGate,
  errResp,
  getServiceClient,
  logAuditEvent,
} from "@/lib/server/queries/staffWorkLogLifecycle"

/**
 * POST /api/staff-work-logs/[id]/dispute
 *
 * confirmed → disputed 전이.
 * 전이 규칙:
 *   - owner / super_admin : 매장 내 임의 confirmed log
 *   - manager             : **자기 담당** confirmed log 만 (snapshot
 *                            manager_membership_id === auth.membership_id)
 *   - settled / voided / draft 는 불가
 *
 * Body: { reason: string } — 필수. 이번 라운드는 DB 에 별도 컬럼 없이
 *   audit_events.reason + metadata 에만 저장 (DB 대수술 금지 제약).
 *
 * 향후 Phase 3 에서 dispute_reason / disputed_by / disputed_at 컬럼
 * 필요시 별도 migration.
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
  // 스펙: reason 또는 memo 둘 중 하나 필수. reason 우선.
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

  const baseErr = checkBaseLifecycleGate(row, auth)
  if (baseErr) return errResp(baseErr)

  if (row.status !== "confirmed") {
    return NextResponse.json(
      {
        error: "STATE_CONFLICT",
        message: `현재 상태(${row.status}) 에서는 dispute 할 수 없습니다. confirmed 만 가능합니다.`,
      },
      { status: 409 },
    )
  }

  // Manager 는 자기 담당 log 에만 이의 제기 가능
  if (isManager && !isOwner && !isSuperAdmin) {
    if (row.manager_membership_id !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ASSIGNMENT_FORBIDDEN",
          message: "자기 담당 로그에만 이의 제기할 수 있습니다.",
        },
        { status: 403 },
      )
    }
  }

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("staff_work_logs")
    .update({
      status: "disputed",
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "이의 처리 실패" },
      { status: 500 },
    )
  }

  try {
    await logAuditEvent(supabase, {
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
        manager_membership_id: row.manager_membership_id,
      },
    })
  } catch {}

  return NextResponse.json({ ok: true, id, status: "disputed" })
}
