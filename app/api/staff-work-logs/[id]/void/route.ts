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
 * POST /api/staff-work-logs/[id]/void
 *
 * 전이:
 *   - draft → voided     : 작성자(manager 본인) 또는 owner / super_admin
 *   - confirmed → voided : owner / super_admin 만
 *   - settled            : SETTLED_LOCKED
 *   - voided             : STATE_CONFLICT
 *
 * Body: { reason: string } — void_reason 필수.
 *
 * No schema change — 기존 voided_by / voided_at / void_reason 활용.
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

  // 전이 규칙 (Phase 2 스펙 + Phase 4 감사):
  //   draft    → 작성자(manager 본인) 또는 owner / super_admin
  //   confirmed → owner / super_admin 만
  //   disputed → owner / super_admin 만
  //
  // Phase 4 감사: "manager 는 타 담당/타 작성 로그를 수정할 수 없다" 규칙에
  //   맞게, draft void 에서 manager 의 경우 created_by === auth.user_id
  //   를 엄격히 요구한다. 이전 코드는 origin 매장 모든 manager 에 대해
  //   허용했는데, 이는 문서화된 계약("작성자 본인")과 어긋났다.
  if (row.status === "draft") {
    if (isManager && !isOwner && !isSuperAdmin) {
      if (row.created_by !== auth.user_id) {
        return NextResponse.json(
          {
            error: "ASSIGNMENT_FORBIDDEN",
            message: "본인이 작성한 draft 로그만 무효화할 수 있습니다.",
          },
          { status: 403 },
        )
      }
    }
    // owner / super_admin: 코어스 게이트(+ origin scope)만 통과하면 가능.
  } else if (row.status === "confirmed" || row.status === "disputed") {
    if (!isOwner && !isSuperAdmin) {
      return NextResponse.json(
        {
          error: "ROLE_FORBIDDEN",
          message: "확정/이의 상태는 사장/운영자만 무효화할 수 있습니다.",
        },
        { status: 403 },
      )
    }
  } else {
    return NextResponse.json(
      {
        error: "INVALID_STATE_TRANSITION",
        message: `현재 상태(${row.status}) 에서는 void 할 수 없습니다.`,
      },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("staff_work_logs")
    .update({
      status: "voided",
      voided_by: auth.user_id,
      voided_at: nowIso,
      void_reason: reason,
      updated_at: nowIso,
    })
    .eq("id", id)

  if (updateErr) {
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: "무효화 업데이트 실패" },
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
