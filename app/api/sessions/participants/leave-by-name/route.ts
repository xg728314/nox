/**
 * POST /api/sessions/participants/leave-by-name
 *
 * 채팅 파싱 "지연 팅" · "지연 종료" · "지연 끝" 등 CHECKOUT event 감지 시
 * client 가 호출. 서버는 해당 매장 내 이름의 active participant 찾아 leave.
 *
 * body: { name: string, store_uuid?: string, room_no?: string }
 *   - name: 아가씨 이름 (parser 가 추출)
 *   - store_uuid: 대상 매장 (기본: auth.store_uuid)
 *   - room_no: (선택) 특정 방 구분 · 동명이인 시 필터
 *
 * 응답: { ok, left: [{participant_id, hostess_name, room_no}], count }
 *
 * 매칭 규칙:
 *   - store_uuid 내 active session_participants
 *   - hostess name = profiles.full_name OR external_name
 *   - 동명이인 여러 개면 · 모두 leave (사용자 의도)
 *   - room_no 지정 시 그 방의 참여자만
 *
 * 권한: owner/manager · super_admin
 * R-chat-checkout-action (2026-08-23)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      name?: string; store_uuid?: string; room_no?: string
    }
    const name = (body.name || "").trim()
    if (!name) return NextResponse.json({ error: "BAD_REQUEST", message: "name required" }, { status: 400 })
    const targetStore = body.store_uuid || auth.store_uuid
    if (!auth.is_super_admin && targetStore !== auth.store_uuid) {
      // 같은 건물 (5-8F) owner/manager 도 허용 (다른 매장 대신 종료)
      const sb0 = getServiceClient()
      const { data: st } = await sb0.from("stores").select("floor").eq("id", targetStore).maybeSingle()
      const floor = (st as { floor: number } | null)?.floor ?? null
      if (!(floor !== null && floor >= 5 && floor <= 8)) {
        return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
      }
    }

    const sb = getServiceClient()
    // 1) 이름 → membership_id 후보 (같은 매장 hostess)
    const { data: profs } = await sb
      .from("profiles")
      .select("id, full_name")
      .eq("full_name", name)
      .is("deleted_at", null)
    const profileIds = ((profs ?? []) as Array<{ id: string; full_name: string }>).map(p => p.id)

    let membershipIds: string[] = []
    if (profileIds.length > 0) {
      const { data: mems } = await sb
        .from("store_memberships")
        .select("id")
        .eq("store_uuid", targetStore)
        .eq("role", "hostess")
        .in("profile_id", profileIds)
        .is("deleted_at", null)
      membershipIds = ((mems ?? []) as Array<{ id: string }>).map(m => m.id)
    }

    // 2) active participants (같은 매장 · membership_id in ... OR external_name = name)
    const filters: string[] = []
    if (membershipIds.length > 0) filters.push(`membership_id.in.(${membershipIds.join(",")})`)
    filters.push(`external_name.eq.${name}`)
    const { data: parts } = await sb
      .from("session_participants")
      .select("id, session_id, membership_id, external_name, room_sessions!inner(room_uuid, store_uuid, status)")
      .eq("store_uuid", targetStore)
      .eq("status", "active")
      .is("deleted_at", null)
      .or(filters.join(","))

    type PartRow = {
      id: string; session_id: string; membership_id: string | null; external_name: string | null;
      room_sessions: { room_uuid: string; store_uuid: string; status: string }
    }
    let candidates = ((parts ?? []) as unknown as PartRow[])
      .filter(p => p.room_sessions?.status === "active")

    // room_no 필터 (선택)
    if (body.room_no) {
      const { data: roomRows } = await sb
        .from("rooms")
        .select("id, room_no")
        .eq("store_uuid", targetStore)
        .eq("room_no", body.room_no)
        .is("deleted_at", null)
      const roomIds = ((roomRows ?? []) as Array<{ id: string }>).map(r => r.id)
      if (roomIds.length > 0) {
        candidates = candidates.filter(p => roomIds.includes(p.room_sessions.room_uuid))
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, left: [], count: 0, message: "매칭 active 참여자 없음" })
    }

    // 3) leave 실행 · status=left · left_at 스탬프
    const nowIso = new Date().toISOString()
    const leftList: Array<{ participant_id: string; hostess_name: string }> = []
    for (const p of candidates) {
      await sb
        .from("session_participants")
        .update({
          status: "left",
          left_at: nowIso,
          memo: "[chat-checkout · 채팅 종료 표기]",
          updated_at: nowIso,
        })
        .eq("id", p.id)
      leftList.push({ participant_id: p.id, hostess_name: p.external_name || name })
    }

    // audit
    try {
      await sb.from("audit_events").insert({
        store_uuid: targetStore,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "session_participants",
        entity_id: leftList[0].participant_id,
        action: "chat_checkout_leave",
        before: { name, count: candidates.length },
        after: { left_at: nowIso, room_no: body.room_no ?? null },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, left: leftList, count: leftList.length })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
