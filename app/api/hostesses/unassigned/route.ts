import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/hostesses/unassigned
 *
 * Lists active hostesses in the caller's store whose
 * `manager_membership_id IS NULL`. Consumed by:
 *   - owner dashboard — "미배정 아가씨" section (pick a manager per row)
 *   - manager dashboard — "내가 맡기" section (one-click self-claim)
 *
 * Access:
 *   - super_admin → if ?store_uuid=<uuid> present, scope to that store;
 *     otherwise scope to auth.store_uuid
 *   - owner / manager → auth.store_uuid only
 *   - other roles / unauth → 403
 *
 * Shape (response):
 *   {
 *     hostesses: [{
 *       membership_id: string,   // store_memberships.id
 *       name: string,
 *       stage_name: string | null,
 *       phone: string | null,
 *       created_at: string
 *     }]
 *   }
 */
export async function GET(request: Request) {
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

  const isOwner = auth.role === "owner"
  const isManager = auth.role === "manager"
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isManager && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "조회 권한이 없습니다." },
      { status: 403 },
    )
  }

  // Scope — super_admin can optionally target another store
  const url = new URL(request.url)
  const targetStoreUuid = isSuperAdmin
    ? (url.searchParams.get("store_uuid") ?? auth.store_uuid)
    : auth.store_uuid

  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from("hostesses")
    .select("membership_id, name, stage_name, phone, created_at")
    .eq("store_uuid", targetStoreUuid)
    .is("manager_membership_id", null)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: "QUERY_FAILED", message: "미배정 아가씨 조회 실패." },
      { status: 500 },
    )
  }

  return NextResponse.json({
    store_uuid: targetStoreUuid,
    hostesses: data ?? [],
  })
}
