import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { computeAttendanceAnomalies } from "@/lib/server/queries/ops/attendanceAnomalies"

/**
 * GET /api/ops/attendance-overview
 *
 * ROUND-OPS-1 — 운영 모니터링 read-only 대시보드 API.
 *
 * 한 번 호출로 "출근 / BLE / 이상 상황" 을 전부 반환한다. 어떤 write 도
 * 수행하지 않는다. 기존 출근/정산/권한 로직을 건드리지 않는다.
 *
 * 권한:
 *   - owner (본인 매장)
 *   - super_admin (?store_uuid 로 임의 매장 대리 가능; 없으면 auth.store_uuid)
 *   - 그 외 → 403
 *
 * Query:
 *   ?store_uuid=<uuid>  (super_admin only)
 *
 * 응답 shape:
 *   {
 *     store_uuid, business_day_id,
 *     attendance: { total, checked_in, checked_out },
 *     ble:        { live_count, auto_checkin_count },
 *     anomalies:  { duplicate_open, recent_checkout_block, tag_mismatch, no_business_day },
 *     sample:     { duplicate_membership_ids[], mismatch_membership_ids[], no_tag_membership_ids[] }
 *   }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  // ── 1. Auth ─────────────────────────────────────────────
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
  const isSuperAdmin = auth.is_super_admin === true
  if (!isOwner && !isSuperAdmin) {
    return NextResponse.json(
      { error: "ROLE_FORBIDDEN", message: "운영 대시보드 권한이 없습니다." },
      { status: 403 },
    )
  }

  // ── 2. Scope 결정 ───────────────────────────────────────
  const url = new URL(request.url)
  const storeParam = url.searchParams.get("store_uuid")
  let storeUuid = auth.store_uuid
  if (isSuperAdmin && storeParam) {
    if (!UUID_RE.test(storeParam)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "store_uuid UUID 형식이 아닙니다." },
        { status: 400 },
      )
    }
    storeUuid = storeParam
  } else if (!isSuperAdmin && storeParam && storeParam !== auth.store_uuid) {
    return NextResponse.json(
      { error: "STORE_SCOPE_FORBIDDEN", message: "다른 매장 조회 권한이 없습니다." },
      { status: 403 },
    )
  }
  if (!storeUuid) {
    return NextResponse.json(
      { error: "STORE_REQUIRED", message: "store_uuid 필요." },
      { status: 400 },
    )
  }

  // ROUND-ALERT-1: 이상 감지 로직을 shared helper 로 위임.
  //   응답 shape 는 이전과 동일. route 는 auth/scope gate 만 담당.
  const supabase = getServiceClient()
  const overview = await computeAttendanceAnomalies(supabase, storeUuid)
  return NextResponse.json(overview)
}
