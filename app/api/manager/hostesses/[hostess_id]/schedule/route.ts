/**
 * GET  /api/manager/hostesses/[hostess_id]/schedule — 아가씨 일정 리스트 (오늘 이후)
 * POST /api/manager/hostesses/[hostess_id]/schedule — 신규 일정 추가
 * DELETE /api/manager/hostesses/[hostess_id]/schedule?id=... — 일정 삭제
 *
 * 표: hostess_schedules (migration 172).
 * 미적용 환경 fallback: 42P01 (undefined_table) 감지 → 빈 리스트 반환.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

type ScheduleRow = {
  id: string
  hostess_membership_id: string
  store_uuid: string
  schedule_type: string
  start_date: string
  end_date: string
  note: string | null
  created_at: string
}

async function guardAuth(request: Request) {
  const auth = await resolveAuthContext(request)
  if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
    throw new AuthError("MEMBERSHIP_INVALID", "Access denied.")
  }
  return auth
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    await guardAuth(request)
    const { hostess_id } = await params
    if (!isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const sb = getServiceClient()
    // 오늘 이후 & 이미 시작한 기간도 포함 (end_date >= 오늘)
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await sb
      .from("hostess_schedules")
      .select("id, hostess_membership_id, store_uuid, schedule_type, start_date, end_date, note, created_at")
      .eq("hostess_membership_id", hostess_id)
      .gte("end_date", today)
      .is("deleted_at", null)
      .order("start_date", { ascending: true })
    if (error) {
      // 42P01 = undefined_table → migration 미적용
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ schedules: [], migration_pending: true })
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ schedules: (data as ScheduleRow[] | null) ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await guardAuth(request)
    const { hostess_id } = await params
    if (!isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      schedule_type?: string
      start_date?: string
      end_date?: string
      note?: string
    }
    const t = body.schedule_type ?? "off"
    if (!["vacation", "off", "sick", "other"].includes(t)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "schedule_type invalid" }, { status: 400 })
    }
    const s = body.start_date
    const e = body.end_date ?? s
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !e || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "start_date / end_date required (YYYY-MM-DD)" }, { status: 400 })
    }
    const sb = getServiceClient()
    // hostess store lookup
    const { data: mem } = await sb
      .from("store_memberships")
      .select("store_uuid")
      .eq("id", hostess_id)
      .maybeSingle()
    const targetStore = (mem as { store_uuid?: string } | null)?.store_uuid ?? auth.store_uuid

    const { data: ins, error } = await sb
      .from("hostess_schedules")
      .insert({
        hostess_membership_id: hostess_id,
        store_uuid: targetStore,
        schedule_type: t,
        start_date: s,
        end_date: e,
        note: body.note ?? null,
        created_by_membership_id: auth.membership_id,
      })
      .select("id, hostess_membership_id, store_uuid, schedule_type, start_date, end_date, note, created_at")
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ error: "MIGRATION_PENDING", message: "일정 기능은 database migration 172 apply 후 활성됩니다." }, { status: 503 })
      }
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ schedule: ins }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    await guardAuth(request)
    const { hostess_id } = await params
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!isValidUUID(hostess_id) || !id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const sb = getServiceClient()
    const { error } = await sb
      .from("hostess_schedules")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("hostess_membership_id", hostess_id)
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      }
      return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
