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
 * POST /api/staff-work-logs/[id]/confirm
 *
 * **pending → confirmed** (cross_store_work_records). owner / super_admin 만.
 *
 * ⚠️ 2026-04-24 수정:
 *   실 테이블은 `cross_store_work_records`. manager_membership_id /
 *   confirmed_by / confirmed_at 컬럼은 **없음**. approval 은
 *   approved_by / approved_at 로 기록.
 *
 * 정책:
 *   - 상태가 pending 이 아니면 INVALID_STATE_TRANSITION (400)
 *   - manager_membership_id 존재 검사 제거 (컬럼 없음)
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

  if (row.status !== "pending") {
    return NextResponse.json(
      {
        error: "INVALID_STATE_TRANSITION",
        message:
          row.status === "disputed"
            ? "disputed 상태는 /resolve 로 재확정하세요."
            : `현재 상태(${row.status}) 에서는 confirm 할 수 없습니다. pending 만 가능합니다.`,
      },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("cross_store_work_records")
    .update({
      status: "confirmed",
      approved_by: auth.membership_id,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: `확정 업데이트 실패: ${updateErr.message}` },
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
      approved_by: auth.membership_id,
    },
  })
  if (auditFail) return auditFail

  return NextResponse.json({ ok: true, id, status: "confirmed" })
}
