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
 * POST /api/staff-work-logs/[id]/confirm
 *
 * draft → confirmed 전이. owner / super_admin 만 가능.
 *
 * 정책:
 *   - 상태가 draft 가 아니면 STATE_CONFLICT
 *   - manager_membership_id 가 null 이면 MANAGER_REQUIRED (400)
 *     → confirmed 는 정산 귀속이 명확해야 하므로 담당 실장 미지정 차단
 *
 * No schema change — 기존 confirmed_by / confirmed_at 활용.
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
      { error: "ROLE_FORBIDDEN", message: "확정 권한이 없습니다." },
      { status: 403 },
    )
  }

  const { row, error: loadErr } = await loadWorkLog(id)
  if (loadErr) return errResp(loadErr)
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

  const baseErr = checkBaseLifecycleGate(row, auth)
  if (baseErr) return errResp(baseErr)

  if (row.status !== "draft") {
    return NextResponse.json(
      {
        error: "STATE_CONFLICT",
        message: `현재 상태(${row.status}) 에서는 confirm 할 수 없습니다. draft 만 가능합니다.`,
      },
      { status: 409 },
    )
  }

  if (!row.manager_membership_id) {
    return NextResponse.json(
      {
        error: "MANAGER_REQUIRED",
        message: "담당 실장 지정이 없으면 확정할 수 없습니다. 먼저 아가씨에 실장을 배정하거나 로그 내용을 보완하세요.",
      },
      { status: 400 },
    )
  }

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
      { error: "UPDATE_FAILED", message: "확정 업데이트 실패" },
      { status: 500 },
    )
  }

  try {
    await logAuditEvent(supabase, {
      auth,
      action: "staff_work_log_confirmed",
      entity_table: "store_memberships",
      entity_id: row.hostess_membership_id,
      before: { status: row.status },
      metadata: {
        work_log_id: id,
        from_status: row.status,
        to_status: "confirmed",
        manager_membership_id: row.manager_membership_id,
      },
    })
  } catch {}

  return NextResponse.json({ ok: true, id, status: "confirmed" })
}
