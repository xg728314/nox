/**
 * GET /api/manager/hostesses/schedules?date=YYYY-MM-DD
 *   본 매장의 특정 날짜 휴가/오프 hostess 리스트 (bulk).
 *   attendance page 에서 각 아가씨 옆에 "오늘 휴가" 뱃지 표시용.
 *
 *   Fallback: 42P01 (undefined_table) → 빈 리스트.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)

    const sb = getServiceClient()
    const { data, error } = await sb
      .from("hostess_schedules")
      .select("hostess_membership_id, schedule_type, start_date, end_date, note")
      .eq("store_uuid", auth.store_uuid)
      .lte("start_date", date)
      .gte("end_date", date)
      .is("deleted_at", null)
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ date, off: [], migration_pending: true })
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    type Row = {
      hostess_membership_id: string
      schedule_type: string
      start_date: string
      end_date: string
      note: string | null
    }
    return NextResponse.json({ date, off: ((data as Row[] | null) ?? []) })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
