/**
 * POST /api/chat/pattern-dispatch/[id]/confirm
 *
 * 수신측 매니저 (target store 매니저) 의 확인 클릭.
 *   pending row 의 target_confirmed_by/at 채움.
 *   같은 chat_message_id 의 모든 row 가 confirm 되면 → status='approved'
 *   동시에 실제 dispatch 실행 (session + participant INSERT).
 *
 * 권한: target_store_uuid 와 auth.store_uuid 일치 (owner/manager) 또는 super_admin.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { isValidUUID } from "@/lib/validation"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()

    // 1. 임시 등록 row 조회
    const { data: row } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, chat_message_id, target_store_uuid, hostess_membership_id, category, time_type, status, target_confirmed_by")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    type Row = {
      id: string; chat_message_id: string; target_store_uuid: string; hostess_membership_id: string
      category: string; time_type: string; status: string; target_confirmed_by: string | null
    }
    const r = row as Row
    if (r.status !== "pending") {
      return NextResponse.json({ error: "NOT_PENDING", status: r.status }, { status: 409 })
    }
    // 권한 — target store 와 일치 또는 super_admin
    if (!auth.is_super_admin && r.target_store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 2. target_confirmed_by/at 채움
    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("chat_pattern_dispatches")
      .update({ target_confirmed_by: auth.user_id, target_confirmed_at: nowIso, updated_at: nowIso })
      .eq("id", id)
      .eq("status", "pending") // race guard
    if (updErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updErr.message }, { status: 500 })
    }

    // 3. 같은 chat_message_id 의 모든 row 가 target_confirmed 인지 확인
    const { data: peers } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, target_store_uuid, hostess_membership_id, category, time_type, target_confirmed_by, status")
      .eq("chat_message_id", r.chat_message_id)
      .is("deleted_at", null)
    type Peer = {
      id: string; target_store_uuid: string; hostess_membership_id: string
      category: string; time_type: string; target_confirmed_by: string | null; status: string
    }
    const peerRows = (peers ?? []) as Peer[]
    const allConfirmed = peerRows.every((p) => p.target_confirmed_by != null)

    let executedAny = false
    if (allConfirmed) {
      // 4. 실제 dispatch 실행 — 각 row 별로 session 생성 + participant INSERT
      for (const p of peerRows) {
        if (p.status !== "pending") continue
        // hostess origin store (그래스풀)
        type HR = { store_uuid: string; name: string; origin_store_uuid?: string | null }
        let hRow: HR | null = null
        const full = await supabase
          .from("hostesses")
          .select("origin_store_uuid, store_uuid, name")
          .eq("membership_id", p.hostess_membership_id)
          .maybeSingle()
        if (full.error && (full.error as { code?: string }).code === "42703") {
          const base = await supabase
            .from("hostesses")
            .select("store_uuid, name")
            .eq("membership_id", p.hostess_membership_id)
            .maybeSingle()
          hRow = (base.data as unknown as HR | null) ?? null
        } else {
          hRow = (full.data as unknown as HR | null) ?? null
        }
        const originStoreUuid = hRow?.origin_store_uuid ?? hRow?.store_uuid ?? null

        // target store 의 manager + 빈 룸 + 단가 + business_day
        const { data: mgrs } = await supabase
          .from("store_memberships")
          .select("id, profile_id")
          .eq("store_uuid", p.target_store_uuid)
          .eq("role", "manager").eq("status", "approved").is("deleted_at", null).limit(1)
        const targetMgr = (mgrs ?? [])[0] as { id: string; profile_id: string } | undefined
        if (!targetMgr) {
          await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: "target store 매니저 없음", updated_at: new Date().toISOString() }).eq("id", p.id)
          continue
        }
        const { data: st } = await supabase
          .from("store_service_types")
          .select("time_minutes, price, manager_deduction, has_greeting_check")
          .eq("store_uuid", p.target_store_uuid)
          .eq("service_type", p.category).eq("time_type", p.time_type).maybeSingle()
        if (!st) {
          await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: "단가 미설정", updated_at: new Date().toISOString() }).eq("id", p.id)
          continue
        }
        type ST = { time_minutes: number; price: number; manager_deduction: number; has_greeting_check: boolean }
        const stRow = st as ST
        // 빈 룸
        const { data: rooms } = await supabase
          .from("rooms").select("id, room_no, room_name, is_active")
          .eq("store_uuid", p.target_store_uuid).eq("is_active", true)
          .order("room_no", { ascending: true })
        const roomList = (rooms ?? []) as Array<{ id: string; room_no: string; room_name: string | null }>
        if (roomList.length === 0) {
          await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: "룸 없음", updated_at: new Date().toISOString() }).eq("id", p.id)
          continue
        }
        const { data: actSess } = await supabase
          .from("room_sessions").select("room_uuid")
          .eq("store_uuid", p.target_store_uuid).eq("status", "active")
        const busy = new Set(((actSess ?? []) as Array<{ room_uuid: string }>).map((s) => s.room_uuid))
        const targetRoom = roomList.find((rm) => !busy.has(rm.id)) ?? roomList[0]

        // business_day
        const today = getBusinessDateForOps()
        const { data: bd } = await supabase
          .from("store_operating_days").select("id, status")
          .eq("store_uuid", p.target_store_uuid).eq("business_date", today).maybeSingle()
        let businessDayId: string
        if (bd) {
          const bdRow = bd as { id: string; status: string }
          if (bdRow.status === "closed") {
            await supabase.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", bdRow.id)
          }
          businessDayId = bdRow.id
        } else {
          const { data: newBd, error: bErr } = await supabase
            .from("store_operating_days")
            .insert({ store_uuid: p.target_store_uuid, business_date: today, status: "open", opened_by: auth.user_id })
            .select("id").single()
          if (bErr || !newBd) {
            await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: `business_day 생성 실패: ${bErr?.message}`, updated_at: new Date().toISOString() }).eq("id", p.id)
            continue
          }
          businessDayId = (newBd as { id: string }).id
        }

        // session
        const { data: sess, error: sErr } = await supabase
          .from("room_sessions")
          .insert({
            store_uuid: p.target_store_uuid,
            room_uuid: targetRoom.id,
            business_day_id: businessDayId,
            status: "active",
            opened_by: auth.user_id,
            manager_membership_id: targetMgr.id,
            is_external_manager: true,
            started_at: new Date().toISOString(),
          })
          .select("id").single()
        if (sErr || !sess) {
          await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: `session 실패: ${sErr?.message}`, updated_at: new Date().toISOString() }).eq("id", p.id)
          continue
        }
        const sessionId = (sess as { id: string }).id

        // cross-store transfer_request (origin != target 일 때만)
        let transferRequestId: string | null = null
        if (originStoreUuid && originStoreUuid !== p.target_store_uuid) {
          const { data: trRow } = await supabase
            .from("transfer_requests")
            .insert({
              hostess_membership_id: p.hostess_membership_id,
              from_store_uuid: originStoreUuid,
              to_store_uuid: p.target_store_uuid,
              business_day_id: businessDayId,
              status: "approved",
              from_store_approved_by: auth.user_id,
              from_store_approved_at: new Date().toISOString(),
              to_store_approved_by: auth.user_id,
              to_store_approved_at: new Date().toISOString(),
              reason: "[chat-pattern mutual confirm]",
            })
            .select("id").single()
          transferRequestId = (trRow as { id: string } | null)?.id ?? null
        }

        const hostessPayout = Math.max(0, stRow.price - (stRow.manager_deduction ?? 0))
        const { data: partRow, error: pErr } = await supabase
          .from("session_participants").insert({
            session_id: sessionId,
            membership_id: p.hostess_membership_id,
            manager_membership_id: targetMgr.id,
            role: "hostess",
            category: p.category,
            time_minutes: stRow.time_minutes,
            price_amount: stRow.price,
            manager_payout_amount: stRow.manager_deduction ?? 0,
            hostess_payout_amount: hostessPayout,
            margin_amount: 0,
            cha3_amount: p.time_type === "차3" ? stRow.price : 0,
            banti_amount: p.time_type === "반티" ? stRow.price : 0,
            waiter_tip_received: false,
            waiter_tip_amount: 0,
            greeting_confirmed: p.category === "셔츠" ? true : false,
            status: "active",
            store_uuid: p.target_store_uuid,
            origin_store_uuid: originStoreUuid && originStoreUuid !== p.target_store_uuid ? originStoreUuid : null,
            transfer_request_id: transferRequestId,
            entered_at: new Date().toISOString(),
          })
          .select("id").single()
        if (pErr || !partRow) {
          await supabase.from("chat_pattern_dispatches").update({ status: "rejected", rejected_reason: `participant: ${pErr?.message}`, updated_at: new Date().toISOString() }).eq("id", p.id)
          continue
        }
        const participantId = (partRow as { id: string }).id

        await supabase
          .from("chat_pattern_dispatches")
          .update({
            status: "approved",
            executed_session_id: sessionId,
            executed_participant_id: participantId,
            executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id)
        executedAny = true
      }
    }

    // 4. 최신 상태 반환
    const { data: latest } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, target_store_uuid, hostess_membership_id, category, time_type, status, target_confirmed_by, executed_session_id")
      .eq("chat_message_id", r.chat_message_id)
      .is("deleted_at", null)
    return NextResponse.json({
      ok: true,
      all_confirmed: allConfirmed,
      executed: executedAny,
      dispatches: latest ?? [],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
