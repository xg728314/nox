import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import {
  UUID_RE,
  loadWorkLog,
  checkBaseLifecycleGate,
  errResp,
  getServiceClient,
} from "@/lib/server/queries/staff/workLogLifecycle"
import { auditOr500 } from "@/lib/audit/logEvent"

/**
 * POST /api/staff-work-logs/[id]/void
 *
 * status → voided (cross_store_work_records).
 *
 * ⚠️ 2026-04-24 수정:
 *   실 테이블 cross_store_work_records 에는 voided_by / voided_at /
 *   void_reason / created_by / manager_membership_id 컬럼이 **없음**.
 *   기존 "draft 본인 작성자만" 분기는 created_by 컬럼 부재로 사용 불가 →
 *   void 권한 정책을 단순화:
 *
 *     - pending / confirmed / disputed → voided
 *     - owner / super_admin 만
 *     - manager 는 본인이 요청한 pending 건만 (requested_by 기반)
 *     - resolved / voided → INVALID_STATE_TRANSITION
 *
 *   void reason 은 audit_events.reason 에만 기록 (DB 컬럼 부재).
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

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!reason) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", message: "무효화 사유(reason)가 필요합니다." },
      { status: 400 },
    )
  }

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isManager && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "무효화 권한이 없습니다." },
      { status: 403 },
    )
  }

  const { row, error: loadErr } = await loadWorkLog(id)
  if (loadErr) return errResp(loadErr)
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

  const baseErr = checkBaseLifecycleGate(row, auth)
  if (baseErr) return errResp(baseErr)

  // 전이 허용 상태 화이트리스트
  if (row.status !== "pending" && row.status !== "confirmed" && row.status !== "disputed") {
    return NextResponse.json(
      {
        error: "INVALID_STATE_TRANSITION",
        message: `현재 상태(${row.status}) 에서는 void 할 수 없습니다.`,
      },
      { status: 400 },
    )
  }

  // manager 는 본인 요청한 pending 건만
  if (isManager && !isOwner && !isSuperAdmin) {
    if (row.status !== "pending") {
      return NextResponse.json(
        {
          error: "ROLE_FORBIDDEN",
          message: "확정/이의 상태는 사장/운영자만 무효화할 수 있습니다.",
        },
        { status: 403 },
      )
    }
    if (row.requested_by !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ASSIGNMENT_FORBIDDEN",
          message: "본인이 요청한 pending 로그만 무효화할 수 있습니다.",
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
      status: "voided",
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: `무효화 업데이트 실패: ${updateErr.message}` },
      { status: 500 },
    )
  }

  const auditFail = await auditOr500(supabase, {
    auth,
    action: "staff_work_log_voided",
    entity_table: "store_memberships",
    entity_id: row.hostess_membership_id,
    before: { status: row.status },
    reason,
    metadata: {
      work_log_id: id,
      from_status: row.status,
      to_status: "voided",
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "voided" })
}
