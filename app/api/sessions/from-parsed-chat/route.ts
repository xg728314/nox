/**
 * Sprint 1 (2026-07-29):
 * POST /api/sessions/from-parsed-chat — 카톡 텍스트 파싱 · 3-tier 자동 라우팅
 *
 * body: {
 *   text: string,
 *   actor_membership_id?: string,   // 발언자 (실장)
 *   actor_store_uuid?: string,      // 발언자 매장
 *   room_no?: string,               // 명시 방번호 (파서 override)
 *   default_category?: string,      // 파서 default
 *   mode?: "dryrun" | "auto"        // dryrun = 파싱만 · auto = 세션 등록
 * }
 *
 * Response:
 *   tier: auto | quiet | pending | fail
 *   confidence: number
 *   resolved: ResolvedEntry[]       (신뢰도·매장·hostess 확정)
 *   session_id?: string             (auto tier 만 · 세션 등록됨)
 *   participants?: {id, ...}[]      (auto tier 만)
 *   pending_id?: string             (pending tier 만 · 확인 대기)
 *
 * Mode:
 *   dryrun (기본): 파싱 결과만 반환 · DB 미변경 (UI preview 용)
 *   auto: tier 별 자동 라우팅:
 *     - auto/quiet: 세션 자동 등록 (매크로 발행은 5분 유예로 broadcast_queue)
 *     - pending: 확인 대기 message 발행 (구현은 Sprint 2)
 *     - fail: 파싱 실패 응답
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseChatWithConfidence, type ResolvedEntry } from "@/lib/session/parseChatWithConfidence"
import { isValidUUID } from "@/lib/validation"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      text?: string
      actor_membership_id?: string
      actor_store_uuid?: string
      room_no?: string
      default_category?: string
      mode?: "dryrun" | "auto"
    }
    const text = body.text?.trim() ?? ""
    if (!text) return NextResponse.json({ error: "BAD_REQUEST", message: "text required" }, { status: 400 })

    const mode = body.mode ?? "dryrun"
    const actorMembershipId = body.actor_membership_id ?? auth.membership_id
    const actorStoreUuid = body.actor_store_uuid ?? auth.store_uuid

    const sb = getServiceClient()

    // 1) 파싱 + 신뢰도 계산
    const result = await parseChatWithConfidence(text, {
      supabase: sb,
      actor_membership_id: actorMembershipId,
      actor_store_uuid: actorStoreUuid,
      default_category: body.default_category ?? null,
    })

    // dryrun · 파싱 결과만 반환
    if (mode === "dryrun") {
      return NextResponse.json({
        mode: "dryrun",
        ...result,
      })
    }

    // auto 모드 · tier 별 처리
    if (result.tier === "fail") {
      return NextResponse.json({
        mode: "auto",
        tier: "fail",
        confidence: result.overall_confidence,
        resolved: result.entries,
        warnings: result.warnings,
        message: "파싱 실패 · 수동 확인 필요",
      })
    }

    if (result.tier === "pending") {
      // Sprint 2 에서 pending queue UI 구현
      // 지금은 응답에 pending 표시만
      return NextResponse.json({
        mode: "auto",
        tier: "pending",
        confidence: result.overall_confidence,
        resolved: result.entries,
        warnings: result.warnings,
        message: "확인 대기 · Sprint 2 에서 매장 방실장 그룹 확인 UI 활성 예정",
      })
    }

    // auto / quiet · 세션 자동 등록
    // 대상 매장 확정 (entries 의 store_uuid · 첫 entry 기준 · 다중 매장 mixed 는 pending 으로 다운그레이드 필요)
    const targetStoreUuids = Array.from(new Set(result.entries.map((e) => e.origin_store_uuid).filter((x): x is string => !!x)))
    if (targetStoreUuids.length === 0) {
      return NextResponse.json({
        mode: "auto",
        tier: "fail",
        confidence: result.overall_confidence,
        resolved: result.entries,
        message: "매장 확정 실패",
      })
    }
    if (targetStoreUuids.length > 1) {
      // 다중 매장 mixed → 이번 라운드는 fail 처리 (Sprint 2 에서 세션 별 분리)
      return NextResponse.json({
        mode: "auto",
        tier: "pending",
        confidence: result.overall_confidence,
        resolved: result.entries,
        message: "다중 매장 언급 · 세션 분리 필요 (Sprint 2)",
      })
    }
    const targetStore = targetStoreUuids[0]

    // 방번호: body.room_no > 파서 entries room_no > null (dispatch 가 빈 방 선택)
    const roomNo = body.room_no?.trim() || result.entries.find((e) => e.room_no)?.room_no || null

    // room lookup (방번호 → room_uuid)
    let roomUuid: string | null = null
    if (roomNo) {
      const { data: rooms } = await sb
        .from("rooms")
        .select("id, room_no")
        .eq("store_uuid", targetStore)
        .eq("room_no", roomNo)
        .is("deleted_at", null)
        .limit(1)
      const rows = (rooms ?? []) as Array<{ id: string; room_no: string }>
      if (rows.length > 0) roomUuid = rows[0].id
    }

    // 활성 세션 있으면 재사용 · 없으면 신규 checkin
    let sessionId: string | null = null
    if (roomUuid) {
      const { data: sess } = await sb
        .from("room_sessions")
        .select("id")
        .eq("room_uuid", roomUuid)
        .eq("status", "active")
        .is("archived_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (sess) sessionId = (sess as { id: string }).id
    }

    if (!sessionId && roomUuid) {
      // 신규 checkin (매니저 = actor)
      const nowIso = new Date().toISOString()
      // business_day lookup
      const { data: bd } = await sb
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", targetStore)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      const businessDayId = (bd as { id?: string } | null)?.id
      if (!businessDayId) {
        return NextResponse.json({
          mode: "auto",
          tier: "fail",
          confidence: result.overall_confidence,
          message: "영업일 없음 · 매장 오픈 후 재시도",
        })
      }
      const { data: newSess, error: sErr } = await sb
        .from("room_sessions")
        .insert({
          store_uuid: targetStore,
          room_uuid: roomUuid,
          business_day_id: businessDayId,
          status: "active",
          started_at: nowIso,
          manager_membership_id: actorMembershipId,
        })
        .select("id")
        .single()
      if (sErr || !newSess) {
        return NextResponse.json({
          mode: "auto", tier: "fail", confidence: result.overall_confidence,
          message: `세션 생성 실패: ${sErr?.message ?? "unknown"}`,
        })
      }
      sessionId = (newSess as { id: string }).id
    }

    // 세션 없으면 (방번호 못 찾음) 실패
    if (!sessionId) {
      return NextResponse.json({
        mode: "auto",
        tier: "fail",
        confidence: result.overall_confidence,
        message: "방번호 확정 실패 · 방번호를 카톡에 명시하거나 UI 에서 방 선택 필요",
      })
    }

    // 참여자 등록 · hostess 있으면 membership_id · 없으면 external_name
    const nowIso = new Date().toISOString()
    const insertedParticipants: Array<{ id: string; membership_id: string | null; external_name: string | null }> = []
    for (const e of result.entries) {
      const payload = {
        session_id: sessionId,
        store_uuid: targetStore,
        role: "hostess",
        category: e.category ?? null,
        time_minutes: ticketToMinutes(e.ticket_type, e.category),
        price_amount: 0, // 실 가격은 별도 pricing lookup · 여기선 0 · 서버 side computed
        manager_payout_amount: 0,
        hostess_payout_amount: 0,
        cha3_amount: 0,
        banti_amount: 0,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: e.category === "셔츠",
        status: "active",
        entered_at: nowIso,
        membership_id: e.hostess_membership_id,
        external_name: e.needs_provisioning ? e.hostess_name_confirmed : null,
        memo: e.needs_provisioning ? `자동파싱 · 미등록 (${e.hostess_name_confirmed})` : null,
        origin_store_uuid: null, // Sprint 2: cross-store 처리
      }
      const { data: p, error: pErr } = await sb
        .from("session_participants")
        .insert(payload)
        .select("id, membership_id, external_name")
        .single()
      if (!pErr && p) {
        insertedParticipants.push(p as { id: string; membership_id: string | null; external_name: string | null })
      }
    }

    // 매크로 발행은 broadcast_queue 로 (5분 유예 · Sprint 2 worker 가 발행)
    // 지금은 즉시 message insert · undo_deadline_at 5분 후 · superseded_at null
    const roomChatRoomId = await ensureRoomSessionChat(sb, sessionId, targetStore, actorMembershipId)
    if (roomChatRoomId) {
      const undoDeadline = new Date(Date.now() + 5 * 60_000).toISOString()
      const macroContent = renderMaidMacro(result.entries)
      const { data: msg } = await sb
        .from("chat_messages")
        .insert({
          chat_room_id: roomChatRoomId,
          store_uuid: targetStore,
          sender_membership_id: actorMembershipId,
          content: macroContent,
          message_type: "macro_maid",
          undo_deadline_at: undoDeadline,
          session_id: sessionId,
          macro_context: {
            confidence: result.overall_confidence,
            tier: result.tier,
            entries: result.entries.map((e) => ({
              name: e.hostess_name_confirmed,
              hostess_membership_id: e.hostess_membership_id,
              needs_provisioning: e.needs_provisioning,
              category: e.category,
              ticket: e.ticket_type,
            })),
          },
          created_at: nowIso,
        })
        .select("id, undo_deadline_at")
        .maybeSingle()
      return NextResponse.json({
        mode: "auto",
        tier: result.tier,
        confidence: result.overall_confidence,
        session_id: sessionId,
        participants: insertedParticipants,
        message_id: (msg as { id?: string } | null)?.id ?? null,
        undo_deadline_at: undoDeadline,
        resolved: result.entries,
      })
    }
    return NextResponse.json({
      mode: "auto",
      tier: result.tier,
      confidence: result.overall_confidence,
      session_id: sessionId,
      participants: insertedParticipants,
      resolved: result.entries,
      note: "매크로 발행 skip · chat_room 없음",
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

// ── helpers ──
function ticketToMinutes(ticket: string | null, category: string | null): number {
  if (!ticket) return 60
  if (ticket === "차3" || ticket === "차") return 15
  if (ticket === "반티" || ticket === "반") return category === "퍼블릭" ? 45 : 30
  if (ticket === "반차3") return category === "퍼블릭" ? 45 : 30
  // 완티/기본
  return category === "퍼블릭" ? 90 : 60
}

function renderMaidMacro(entries: ResolvedEntry[]): string {
  const names = entries.map((e) => e.hostess_name_confirmed).filter(Boolean).join("·")
  const stores = Array.from(new Set(entries.map((e) => e.origin_store_name_confirmed).filter((x): x is string => !!x)))
  const category = entries[0]?.category ?? ""
  const ticket = entries[0]?.ticket_type ?? ""
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, "0")
  const mm = String(t.getMinutes()).padStart(2, "0")
  const parts: string[] = ["✅"]
  if (stores.length > 0) parts.push(stores.join("·"))
  if (names) parts.push(names)
  if (category) parts.push(category)
  if (ticket) parts.push(ticket)
  parts.push(`(${hh}:${mm})`)
  return parts.join(" ")
}

async function ensureRoomSessionChat(
  sb: ReturnType<typeof getServiceClient>,
  sessionId: string,
  storeUuid: string,
  actorMembershipId: string,
): Promise<string | null> {
  // 기존 room_session chat 있으면 재사용 · 없으면 생성
  const { data: existing } = await sb
    .from("chat_rooms")
    .select("id")
    .eq("type", "room_session")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: newRoom } = await sb
    .from("chat_rooms")
    .insert({
      store_uuid: storeUuid,
      type: "room_session",
      session_id: sessionId,
      name: "룸 채팅",
      is_active: true,
      created_by: actorMembershipId,
    })
    .select("id")
    .maybeSingle()
  return (newRoom as { id?: string } | null)?.id ?? null
}
