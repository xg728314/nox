/**
 * POST /api/cross-store/dispatch
 *
 * 매장 A 의 사장/실장 (또는 super_admin) 이 자신의 식구를 매장 B 로 보내는
 * "타매장 배정" 1-콜 endpoint. 기존 work-record 는 이미 만들어진 session 에
 * 등록만 — 본 route 는 session 자동 개설 + 참여자 등록을 같이 처리.
 *
 * Body:
 *   {
 *     target_store_uuid: string   // 보낼 매장 (work store)
 *     hostess_membership_ids: string[]
 *     category: "퍼블릭" | "셔츠" | "하퍼"
 *     time_type: "기본" | "반티" | "차3"
 *   }
 *
 * 서버 로직:
 *   1. authContext.role 검증 (hostess 차단)
 *   2. target_store_uuid 유효성 (active store)
 *   3. target store 의 매니저 1명 자동 선택 (status=approved 첫 번째)
 *   4. target store 의 빈 룸 1개 자동 선택 (없으면 첫 active 룸)
 *   5. target store business_day_id 보장 (없으면 오늘 자 자동 open)
 *   6. room_sessions INSERT (manager = step 3, opened_by = authContext.user_id)
 *   7. 각 hostess: store_uuid=target, origin_store_uuid=hostess 원소속
 *      + 카테고리/시간/가격은 target store_service_types 에서 조회
 *   8. (optional) cross_store_work_records row 도 생성 — 정산 추적용
 *
 * 권한:
 *   - super_admin: 항상 허용
 *   - manager / owner: hostess 가 본인 매장 소속 이어야 (자기 식구를 다른 매장으로)
 *
 * 응답:
 *   { ok, session_id, room: { id, room_no }, target_store, participants_created }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { syncRoomSessionChat } from "@/lib/chat/services/syncRoomSessionChat"

type Cat = "퍼블릭" | "셔츠" | "하퍼"
type TimeType = "기본" | "반티" | "차3"

const CAT_SET: ReadonlySet<string> = new Set(["퍼블릭", "셔츠", "하퍼"])
const TIME_SET: ReadonlySet<string> = new Set(["기본", "반티", "차3"])

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "hostess 역할은 배정 불가." }, { status: 403 })
    }

    const parsed = await parseJsonBody<{
      target_store_uuid?: string
      hostess_membership_ids?: string[]
      category?: string
      time_type?: string
    }>(request)
    if (parsed.error) return parsed.error
    const { target_store_uuid, hostess_membership_ids, category, time_type } = parsed.body

    if (!target_store_uuid || typeof target_store_uuid !== "string") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_store_uuid required" }, { status: 400 })
    }
    if (!Array.isArray(hostess_membership_ids) || hostess_membership_ids.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "hostess_membership_ids required" }, { status: 400 })
    }
    if (!category || !CAT_SET.has(category)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "category invalid" }, { status: 400 })
    }
    if (!time_type || !TIME_SET.has(time_type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "time_type invalid" }, { status: 400 })
    }
    const cat = category as Cat
    const ttype = time_type as TimeType

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. target store 검증
    const { data: targetStore } = await supabase
      .from("stores")
      .select("id, store_name, floor, is_active")
      .eq("id", target_store_uuid)
      .maybeSingle()
    if (!targetStore || targetStore.is_active === false) {
      return NextResponse.json({ error: "TARGET_STORE_INVALID", message: "대상 매장을 찾을 수 없거나 비활성." }, { status: 404 })
    }

    // 2. target store 매니저 1명 자동 선택
    const { data: mgrs } = await supabase
      .from("store_memberships")
      .select("id, profile_id")
      .eq("store_uuid", target_store_uuid)
      .eq("role", "manager")
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(1)
    const targetMgr = (mgrs ?? [])[0] as { id: string; profile_id: string } | undefined
    if (!targetMgr) {
      return NextResponse.json({ error: "TARGET_STORE_NO_MANAGER", message: `${targetStore.store_name} 매장에 매니저가 없습니다.` }, { status: 422 })
    }

    // 3. target store 의 종목 단가
    const { data: stRow } = await supabase
      .from("store_service_types")
      .select("time_minutes, price, manager_deduction, has_greeting_check")
      .eq("store_uuid", target_store_uuid)
      .eq("service_type", cat)
      .eq("time_type", ttype)
      .maybeSingle()
    if (!stRow) {
      return NextResponse.json({ error: "PRICE_NOT_CONFIGURED", message: `${targetStore.store_name}: ${cat}/${ttype} 단가 미설정.` }, { status: 422 })
    }

    // 4. target store 의 빈 룸 1개 (없으면 첫 active 룸)
    const { data: roomList } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active")
      .eq("store_uuid", target_store_uuid)
      .eq("is_active", true)
      .order("room_no", { ascending: true })
    const rooms = (roomList ?? []) as Array<{ id: string; room_no: string; room_name: string | null }>
    if (rooms.length === 0) {
      return NextResponse.json({ error: "TARGET_STORE_NO_ROOM", message: `${targetStore.store_name} 매장에 룸 없음.` }, { status: 422 })
    }
    // 현재 활성 세션이 없는 룸 우선
    const { data: activeSessions } = await supabase
      .from("room_sessions")
      .select("room_uuid")
      .eq("store_uuid", target_store_uuid)
      .eq("status", "active")
    const busyRoomIds = new Set(((activeSessions ?? []) as Array<{ room_uuid: string }>).map((s) => s.room_uuid))
    const targetRoom = rooms.find((r) => !busyRoomIds.has(r.id)) ?? rooms[0]

    // 5. business_day_id 보장
    const today = getBusinessDateForOps()
    const { data: bd } = await supabase
      .from("store_operating_days")
      .select("id, status")
      .eq("store_uuid", target_store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    let businessDayId: string
    if (bd) {
      if (bd.status === "closed") {
        await supabase.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", bd.id)
      }
      businessDayId = bd.id
    } else {
      const { data: newBd, error: bdErr } = await supabase
        .from("store_operating_days")
        .insert({ store_uuid: target_store_uuid, business_date: today, status: "open", opened_by: auth.user_id })
        .select("id")
        .single()
      if (bdErr || !newBd) {
        return NextResponse.json({ error: "BUSINESS_DAY_CREATE_FAILED", message: bdErr?.message ?? "business_day 생성 실패" }, { status: 500 })
      }
      businessDayId = newBd.id
    }

    // 6. session 개설 (또는 빈 룸 active 재사용)
    let sessionId: string
    const reuse = !busyRoomIds.has(targetRoom.id) ? null : (activeSessions ?? []).find((s) => s.room_uuid === targetRoom.id)
    if (reuse) {
      // 재사용 — but we need session ID (re-query)
      const { data: existingSess } = await supabase
        .from("room_sessions")
        .select("id")
        .eq("store_uuid", target_store_uuid)
        .eq("room_uuid", targetRoom.id)
        .eq("status", "active")
        .maybeSingle()
      if (!existingSess) {
        return NextResponse.json({ error: "SESSION_REUSE_FAILED", message: "기존 세션 조회 실패" }, { status: 500 })
      }
      sessionId = existingSess.id
    } else {
      const { data: sess, error: sErr } = await supabase
        .from("room_sessions")
        .insert({
          store_uuid: target_store_uuid,
          room_uuid: targetRoom.id,
          business_day_id: businessDayId,
          status: "active",
          opened_by: auth.user_id,
          manager_membership_id: targetMgr.id,
          is_external_manager: true, // 본 매장 매니저가 아닌 dispatcher 가 연 세션
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (sErr || !sess) {
        if (sErr?.code === "23505") {
          return NextResponse.json({ error: "SESSION_CONFLICT", message: "동시 충돌 — 다시 시도하세요" }, { status: 409 })
        }
        return NextResponse.json({ error: "SESSION_CREATE_FAILED", message: sErr?.message ?? "세션 생성 실패" }, { status: 500 })
      }
      sessionId = sess.id
    }

    // 7. 참여자 등록 — hostess 각각의 origin_store_uuid 가져와서
    //    cross-store 인 경우 DB 트리거 "교차 스토어에는 transfer_request_id 가
    //    필요합니다" 를 만족하기 위해 transfer_request 자동 생성 (즉시 approved).
    let createdCount = 0
    const errors: string[] = []

    // 재입실 방지 — 이미 active 상태인 식구는 reject.
    //   시간상 불가능한 중복 배정 (1타임 종료 안 했는데 새 세션 입실) 차단.
    //   end 버튼으로 명시적 종료 후 재배정 가능.
    const { data: activeRows } = await supabase
      .from("session_participants")
      .select("membership_id, store_uuid")
      .in("membership_id", hostess_membership_ids)
      .eq("status", "active")
      .is("deleted_at", null)
    const alreadyActive = new Set(((activeRows ?? []) as { membership_id: string }[]).map((r) => r.membership_id))

    for (const hmid of hostess_membership_ids) {
      if (alreadyActive.has(hmid)) {
        // hostess 이름 조회 시도 (간단 lookup)
        const { data: nameRow } = await supabase
          .from("hostesses")
          .select("name")
          .eq("membership_id", hmid)
          .maybeSingle()
        const nm = (nameRow as { name?: string } | null)?.name ?? hmid.slice(0, 8)
        errors.push(`${nm}: 이미 다른 세션에서 일하는 중 — 먼저 종료해야 재배정 가능`)
        continue
      }
      // hostess 정보 — origin_store_uuid 추적.
      // 1차 시도: origin_store_uuid 컬럼 포함. 컬럼 없으면 42703 → 재시도.
      type HostessRow = { store_uuid: string; name: string; origin_store_uuid?: string | null }
      let hostessRow: HostessRow | null = null
      const full = await supabase
        .from("hostesses")
        .select("origin_store_uuid, store_uuid, name")
        .eq("membership_id", hmid)
        .maybeSingle()
      if (full.error && (full.error as { code?: string }).code === "42703") {
        const base = await supabase
          .from("hostesses")
          .select("store_uuid, name")
          .eq("membership_id", hmid)
          .maybeSingle()
        hostessRow = (base.data as unknown as HostessRow | null) ?? null
      } else {
        hostessRow = (full.data as unknown as HostessRow | null) ?? null
      }

      const originStore = hostessRow?.origin_store_uuid ?? hostessRow?.store_uuid ?? null

      // R-dispatch-perm-fix (2026-06-28): 권한 체크 수정.
      //   이전: originStore !== auth.store_uuid 이면 거부 → 외부 식구를 본 매장에
      //         부르는 정당한 케이스도 차단됨 ("미라: 본인 매장 식구 아님" 에러).
      //   수정: 둘 중 하나면 OK —
      //     A) target_store_uuid === auth.store_uuid (자기 매장에 외부 식구 부름)
      //     B) originStore === auth.store_uuid (자기 식구를 외부 매장에 보냄)
      if (!auth.is_super_admin) {
        const isCallingToOwn = target_store_uuid === auth.store_uuid
        const isSendingOwn = originStore === auth.store_uuid
        if (!isCallingToOwn && !isSendingOwn) {
          errors.push(`${hostessRow?.name ?? hmid}: 본인 매장 관련 dispatch 아님 (target/origin 모두 외부)`)
          continue
        }
      }

      // cross-store 일 때 transfer_request 자동 생성 (DB 트리거 충족용)
      let transferRequestId: string | null = null
      if (originStore && originStore !== target_store_uuid) {
        // 기존 approved request 있는지 먼저 확인 (멱등성 — 같은 영업일 + 같은 hostess + same from/to)
        const { data: existingTr } = await supabase
          .from("transfer_requests")
          .select("id")
          .eq("hostess_membership_id", hmid)
          .eq("from_store_uuid", originStore)
          .eq("to_store_uuid", target_store_uuid)
          .eq("business_day_id", businessDayId)
          .eq("status", "approved")
          .limit(1)
          .maybeSingle()
        if (existingTr?.id) {
          transferRequestId = existingTr.id
        } else {
          const nowIso = new Date().toISOString()
          const { data: trRow, error: trErr } = await supabase
            .from("transfer_requests")
            .insert({
              hostess_membership_id: hmid,
              from_store_uuid: originStore,
              to_store_uuid: target_store_uuid,
              business_day_id: businessDayId,
              status: "approved",
              from_store_approved_by: auth.user_id,
              from_store_approved_at: nowIso,
              to_store_approved_by: auth.user_id,
              to_store_approved_at: nowIso,
              reason: `[dispatch] ${auth.is_super_admin ? "운영자" : auth.role} 즉시 배정`,
            })
            .select("id")
            .single()
          if (trErr || !trRow) {
            errors.push(`${hostessRow?.name ?? hmid}: transfer_request 생성 실패 — ${trErr?.message ?? "?"}`)
            continue
          }
          transferRequestId = trRow.id
        }
      }

      const hostessPayout = Math.max(0, stRow.price - (stRow.manager_deduction ?? 0))
      const { error: pErr } = await supabase.from("session_participants").insert({
        session_id: sessionId,
        membership_id: hmid,
        manager_membership_id: targetMgr.id,
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
        store_uuid: target_store_uuid,
        // DB check constraint session_participants_origin_not_self —
        // origin === store 이면 거부. same-store dispatch 시 origin 을 null 로.
        origin_store_uuid: originStore && originStore !== target_store_uuid ? originStore : null,
        transfer_request_id: transferRequestId,
        entered_at: new Date().toISOString(),
      })
      if (pErr) {
        errors.push(`${hostessRow?.name ?? hmid}: ${pErr.message}`)
        continue
      }
      createdCount++

      // cross_store_work_records — origin != target 일 때만
      if (originStore && originStore !== target_store_uuid) {
        try {
          await supabase
            .from("cross_store_work_records")
            .insert({
              session_id: sessionId,
              business_day_id: businessDayId,
              working_store_uuid: target_store_uuid,
              origin_store_uuid: originStore,
              hostess_membership_id: hmid,
              requested_by: auth.user_id,
              status: "approved", // dispatcher 가 직접 보내는 거라 즉시 approved
            })
        } catch {
          /* 멱등 / 중복 — best-effort */
        }
      }
    }

    // audit
    void writeSessionAudit(supabase, {
      auth,
      session_id: sessionId,
      entity_table: "room_sessions",
      entity_id: sessionId,
      action: "cross_store_dispatch",
      after: {
        target_store_uuid,
        target_store_name: targetStore.store_name,
        room_uuid: targetRoom.id,
        category: cat,
        time_type: ttype,
        hostess_count: createdCount,
        errors,
      },
    }).catch(() => { /* best-effort */ })

    // R-room-chat-sync (2026-06-26): 외부 식구 + 본 매장 식구 + 담당 실장을
    //   방 채팅(room_session) 에 자동 참여. 사용자 요구: "방번호로 분류".
    //   background fire — 실패해도 dispatch 응답 막지 않음.
    if (createdCount > 0) {
      void syncRoomSessionChat(supabase, {
        session_id: sessionId,
        store_uuid: target_store_uuid,
        actor_membership_id: auth.membership_id,
      }).catch(() => { /* best-effort */ })
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      room: { id: targetRoom.id, room_no: targetRoom.room_no, room_name: targetRoom.room_name },
      target_store: { id: targetStore.id, name: targetStore.store_name, floor: targetStore.floor },
      participants_created: createdCount,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
