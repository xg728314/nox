/**
 * POST /api/cross-store/settle-group
 *
 * 본 매장 (working_store = auth.store_uuid) 에서 일한 타매장 식구 그룹의
 * payout_settled_at 을 일괄 갱신.
 *
 * 그룹 키: (origin_store_uuid, origin_manager_membership_id) — 원소속 매장+실장.
 * origin_manager_membership_id 가 null 이면 "미배정" 그룹.
 *
 * Body:
 *   {
 *     origin_store_uuid: string,
 *     origin_manager_membership_id: string | null,
 *     business_day_id?: string,  // 옵션 — 미지정 시 오늘
 *     settled: boolean           // true → 정산완료 stamp, false → 해제 (null)
 *   }
 *
 * 권한: owner / manager (manager 는 본인 store_uuid 만).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { isValidUUID } from "@/lib/validation"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      origin_store_uuid?: string
      origin_manager_membership_id?: string | null
      business_day_id?: string
      settled?: boolean
    }

    if (!body.origin_store_uuid || !isValidUUID(body.origin_store_uuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "origin_store_uuid 가 필요합니다." },
        { status: 400 },
      )
    }
    if (typeof body.settled !== "boolean") {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "settled (boolean) 가 필요합니다." },
        { status: 400 },
      )
    }
    if (
      body.origin_manager_membership_id != null &&
      !isValidUUID(body.origin_manager_membership_id)
    ) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "origin_manager_membership_id 가 유효하지 않습니다." },
        { status: 400 },
      )
    }

    const supabase = getServiceClient()

    // business_day_id 결정
    let businessDayId = body.business_day_id ?? null
    if (!businessDayId) {
      const today = getBusinessDateForOps()
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_date", today)
        .maybeSingle()
      businessDayId = bizDay?.id ?? null
    }
    if (!businessDayId) {
      return NextResponse.json(
        { error: "NO_BUSINESS_DAY", message: "오늘 영업일이 없습니다." },
        { status: 400 },
      )
    }

    // 해당 영업일 본 매장 세션 ID
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
    if (sessionIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, note: "no_sessions" })
    }

    // 대상 participant 조회 — origin_store + 같은 매니저 그룹
    // origin_manager 그룹핑은 hostesses.manager_membership_id 기준.
    // 매니저 필터: null 이면 hostesses.manager_membership_id IS NULL,
    //   값이면 그 manager_membership_id 인 hostesses 의 membership 만.
    type PRow = { id: string; membership_id: string }
    const { data: candidates } = await supabase
      .from("session_participants")
      .select("id, membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("origin_store_uuid", body.origin_store_uuid)
      .in("session_id", sessionIds)
      .is("deleted_at", null)
    const cand = (candidates ?? []) as PRow[]
    if (cand.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, note: "no_participants" })
    }

    // hostess 의 manager 매핑
    const mids = Array.from(new Set(cand.map((c) => c.membership_id)))
    const { data: hRows } = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id")
      .in("membership_id", mids)
    type HRow = { membership_id: string; manager_membership_id: string | null }
    const mgrByMid = new Map<string, string | null>()
    for (const h of (hRows ?? []) as HRow[]) {
      mgrByMid.set(h.membership_id, h.manager_membership_id)
    }

    const wantMgr = body.origin_manager_membership_id ?? null
    const targetIds = cand
      .filter((c) => (mgrByMid.get(c.membership_id) ?? null) === wantMgr)
      .map((c) => c.id)

    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, note: "no_match" })
    }

    // 갱신
    const settledAt = body.settled ? new Date().toISOString() : null
    const settledBy = body.settled ? auth.user_id : null
    const { error: upErr } = await supabase
      .from("session_participants")
      .update({
        payout_settled_at: settledAt,
        payout_settled_by: settledBy,
      })
      .in("id", targetIds)
    if (upErr) {
      return NextResponse.json(
        { error: "DB_ERROR", message: upErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      updated: targetIds.length,
      settled: body.settled,
      settled_at: settledAt,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status =
        e.type === "AUTH_MISSING" ? 401 :
        e.type === "AUTH_INVALID" ? 401 :
        e.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        e.type === "MEMBERSHIP_INVALID" ? 403 :
        e.type === "MEMBERSHIP_NOT_APPROVED" ? 403 : 500
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    console.error("[cross-store/settle-group] POST error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
