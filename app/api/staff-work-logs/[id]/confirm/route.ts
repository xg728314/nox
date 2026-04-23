import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkBaseLifecycleGate,
  errResp,
  getServiceClient,
} from "@/lib/server/queries/staffWorkLogLifecycle"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/staff-work-logs/[id]/confirm
 *
 * **draft → confirmed** 전용. owner / super_admin 만.
 *
 * disputed → confirmed 는 **별도 경로** `/resolve` 로 이동 (Phase 3-A).
 * audit action 을 'staff_work_log_confirmed' vs 'staff_work_log_resolved'
 * 로 분리해 운영 이력에서 "최초 확정" 과 "분쟁 해결 후 재확정" 을 구별
 * 할 수 있게 한다. 본 route 에 disputed 를 들고 오면 400
 * INVALID_STATE_TRANSITION.
 *
 * 정책:
 *   - 상태가 draft 가 아니면 INVALID_STATE_TRANSITION (400)
 *   - manager_membership_id 가 null 이면 MANAGER_REQUIRED (400)
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
    // disputed 는 resolve route 로. 여기서는 400.
    return NextResponse.json(
      {
        error: "INVALID_STATE_TRANSITION",
        message:
          row.status === "disputed"
            ? "disputed 상태는 /resolve 로 재확정하세요."
            : `현재 상태(${row.status}) 에서는 confirm 할 수 없습니다. draft 만 가능합니다.`,
      },
      { status: 400 },
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

  const auditFail = await auditOr500(supabase, {
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
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "confirmed" })
}
