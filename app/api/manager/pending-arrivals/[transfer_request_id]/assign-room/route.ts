/**
 * POST /api/manager/pending-arrivals/[transfer_request_id]/assign-room
 *
 * "도착 대기" 아가씨를 실제 방으로 배정 (session + participant 정식 등록).
 *
 * Body: { room_uuid: string }
 *
 * 로직:
 *   1. transfer_request 조회 · to_store_uuid = auth.store_uuid 검증
 *   2. reason JSON 파싱 → category/time_type 획득
 *   3. target room 검증 (본 매장 소속)
 *   4. business_day_id 확보 (오늘 자)
 *   5. target room 의 active session 있으면 재사용, 없으면 생성
 *   6. session_participants insert (transfer_request_id 링크)
 *   7. 결과 반환 + audit
 *
 * R-pending-pool (2026-08-31): cross-store/dispatch mode="pending" 후속.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

type Metadata = { category?: string; time_type?: string }

const CAT_SET = new Set(["퍼블릭", "셔츠", "하퍼"])
const TIME_SET = new Set(["기본", "반티", "차3"])

function parseMetadata(reason: string | null): Metadata {
  if (!reason) return {}
  try {
    const j = JSON.parse(reason)
    if (typeof j === "object" && j !== null) return j as Metadata
  } catch { /* legacy */ }
  return {}
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transfer_request_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { transfer_request_id } = await params
    if (!transfer_request_id || !isValidUUID(transfer_request_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "transfer_request_id required" }, { status: 400 })
    }
    const parsed = await parseJsonBody<{ room_uuid?: string }>(request)
    if (parsed.error) return parsed.error
    const roomUuid = parsed.body.room_uuid
    if (!roomUuid || !isValidUUID(roomUuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "room_uuid required" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. transfer_request 조회
    const { data: tr } = await supabase
      .from("transfer_requests")
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, reason")
      .eq("id", transfer_request_id)
      .maybeSingle()
    if (!tr) {
      return NextResponse.json({ error: "TRANSFER_REQUEST_NOT_FOUND" }, { status: 404 })
    }
    if (tr.status !== "approved") {
      return NextResponse.json({ error: "TRANSFER_REQUEST_NOT_APPROVED", message: `status=${tr.status}` }, { status: 409 })
    }
    if (tr.to_store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 2. 이미 등록된 요청이면 reject
    const { data: existingP } = await supabase
      .from("session_participants")
      .select("id, session_id")
      .eq("transfer_request_id", transfer_request_id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()
    if (existingP) {
      return NextResponse.json({
        error: "ALREADY_ASSIGNED",
        message: "이미 배정된 요청입니다.",
        participant_id: existingP.id,
        session_id: existingP.session_id,
      }, { status: 409 })
    }

    // 3. metadata 파싱
    const meta = parseMetadata(tr.reason)
    const cat = meta.category
    const ttype = meta.time_type
    if (!cat || !CAT_SET.has(cat) || !ttype || !TIME_SET.has(ttype)) {
      return NextResponse.json({
        error: "METADATA_INVALID",
        message: "요청에 종목/시간 정보 없음 — 재요청 필요",
      }, { status: 422 })
    }

    // 4. room 검증
    const { data: room } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, store_uuid, is_active")
      .eq("id", roomUuid)
      .maybeSingle()
    if (!room || room.is_active === false) {
      return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 })
    }
    if (room.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "ROOM_STORE_MISMATCH" }, { status: 400 })
    }

    // 5. 종목 단가 (본 매장 = target)
    const { data: stRow } = await supabase
      .from("store_service_types")
      .select("time_minutes, price, manager_deduction, has_greeting_check")
      .eq("store_uuid", auth.store_uuid)
      .eq("service_type", cat)
      .eq("time_type", ttype)
      .maybeSingle()
    if (!stRow) {
      return NextResponse.json({ error: "PRICE_NOT_CONFIGURED", message: `${cat}/${ttype} 단가 미설정` }, { status: 422 })
    }

    // 6. business_day_id 확보 (오늘 자)
    let businessDayId = tr.business_day_id as string | null
    if (!businessDayId) {
      const today = getBusinessDateForOps()
      const { data: bd } = await supabase
        .from("store_operating_days")
        .select("id, status")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_date", today)
        .maybeSingle()
      if (bd) {
        if (bd.status === "closed") {
          await supabase
            .from("store_operating_days")
            .update({ status: "open", closed_at: null, closed_by: null })
            .eq("id", bd.id)
        }
        businessDayId = bd.id
      } else {
        const { data: newBd, error: bdErr } = await supabase
          .from("store_operating_days")
          .insert({ store_uuid: auth.store_uuid, business_date: today, status: "open", opened_by: auth.user_id })
          .select("id").single()
        if (bdErr || !newBd) {
          return NextResponse.json({ error: "BUSINESS_DAY_FAILED", message: bdErr?.message ?? "?" }, { status: 500 })
        }
        businessDayId = newBd.id
      }
    }

    // 7. active session 재사용 or 생성
    //    R-auto-manager (2026-08-31): 세션 신규 생성 시 배정자를 자동 실장으로.
    //    사용자 요구: "배정 = 체크인 · 배정한 사람이 담당 실장".
    //    기존 active session 이면 그 매니저 유지 (덮어쓰기 X).
    let sessionId: string
    const { data: activeSess } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("room_uuid", roomUuid)
      .eq("status", "active")
      .maybeSingle()
    if (activeSess) {
      sessionId = activeSess.id
    } else {
      // 배정자의 이름 lookup (profiles.full_name)
      let assignerName: string | null = null
      const { data: prof } = await supabase
        .from("profiles").select("full_name").eq("id", auth.user_id).maybeSingle()
      if (prof?.full_name) assignerName = prof.full_name
      // membership 이 owner/manager 인지 확인 (hostess 는 이미 route 초입에서 차단됨)
      const { data: newSess, error: sErr } = await supabase
        .from("room_sessions")
        .insert({
          store_uuid: auth.store_uuid,
          room_uuid: roomUuid,
          business_day_id: businessDayId,
          status: "active",
          opened_by: auth.user_id,
          manager_membership_id: auth.membership_id,
          manager_name: assignerName,
          is_external_manager: false,
          started_at: new Date().toISOString(),
        })
        .select("id").single()
      if (sErr || !newSess) {
        if (sErr?.code === "23505") {
          // race → 재조회
          const { data: raceSess } = await supabase
            .from("room_sessions")
            .select("id")
            .eq("store_uuid", auth.store_uuid)
            .eq("room_uuid", roomUuid)
            .eq("status", "active")
            .maybeSingle()
          if (raceSess) sessionId = raceSess.id
          else return NextResponse.json({ error: "SESSION_CREATE_FAILED", message: "race" }, { status: 500 })
        } else {
          return NextResponse.json({ error: "SESSION_CREATE_FAILED", message: sErr?.message ?? "?" }, { status: 500 })
        }
      } else {
        sessionId = newSess.id
      }
    }

    // 8. participant insert (transfer_request_id 링크)
    const hostessPayout = Math.max(0, stRow.price - (stRow.manager_deduction ?? 0))
    const { data: newPart, error: pErr } = await supabase
      .from("session_participants")
      .insert({
        session_id: sessionId,
        membership_id: tr.hostess_membership_id,
        role: "hostess",
        category: cat,
        time_minutes: stRow.time_minutes,
        price_amount: stRow.price,
        manager_payout_amount: stRow.manager_deduction ?? 0,
        hostess_payout_amount: hostessPayout,
        margin_amount: 0,
        cha3_amount: ttype === "차3" ? stRow.price : 0,
        banti_amount: ttype === "반티" ? stRow.price : 0,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: cat === "셔츠" ? true : false,
        status: "active",
        store_uuid: auth.store_uuid,
        origin_store_uuid: tr.from_store_uuid,
        transfer_request_id: tr.id,
        entered_at: new Date().toISOString(),
      })
      .select("id, entered_at").single()
    if (pErr || !newPart) {
      return NextResponse.json({ error: "PARTICIPANT_INSERT_FAILED", message: pErr?.message ?? "?" }, { status: 500 })
    }

    // 9. audit (background)
    void writeSessionAudit(supabase, {
      auth,
      session_id: sessionId,
      entity_table: "session_participants",
      entity_id: newPart.id,
      action: "pending_arrival_assigned",
      after: {
        transfer_request_id: tr.id,
        room_uuid: roomUuid,
        category: cat,
        time_type: ttype,
      },
    }).catch((e) => console.warn("[assign-room] audit:", e instanceof Error ? e.message : e))

    invalidateCache("rooms")
    invalidateCache("monitor")
    invalidateCache("room_participants")

    return NextResponse.json({
      ok: true,
      participant_id: newPart.id,
      session_id: sessionId,
      room_uuid: roomUuid,
      room_no: room.room_no,
      category: cat,
      time_type: ttype,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: (error as Error).message },
      { status: 500 },
    )
  }
}
