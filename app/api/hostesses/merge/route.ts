/**
 * POST /api/hostesses/merge — 동명이인 hostess 병합.
 *
 * R-hostess-merge (2026-09-04): 실수로 만들어진 duplicate (같은 사람) 통합.
 *
 * Body: { from_membership_id, to_membership_id }
 *   - from = 병합될 (삭제될) hostess
 *   - to   = canonical (유지) hostess
 *
 * 규칙:
 *   1. from ≠ to · 둘 다 존재 · 둘 다 같은 매장 · from active
 *   2. owner/manager (매장 일치) or super_admin 만
 *   3. from 의 이력 to 로 이관:
 *      · session_participants.membership_id → to
 *      · transfer_requests.hostess_membership_id → to
 *      · chat_participants → upsert 로 dedup 후 to 로
 *      · alias_learnings.resolved_id (hostess) → to
 *      · hostesses.manager_membership_id 참조 (다른 아가씨 담당) → keep as-is (사장 판단)
 *   4. from soft-delete: hostesses.deleted_at, is_active=false
 *   5. from store_membership soft-delete
 *   6. audit: hostess_merged (before/after)
 *
 * 응답: { ok, moved_participants, moved_transfers, moved_chat_rows }
 *
 * ⚠ irreversible · undo 없음. Client 는 confirm modal 필수.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { ensurePerm } from "@/lib/auth/requirePerm"
import { PERMS } from "@/lib/auth/permissions"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    // R33 (2026-09-04): staff.manage 권한 게이트 (병합 = irreversible · 최소 STAFF_MANAGE)
    const permErr = await ensurePerm(auth, PERMS.STAFF_MANAGE)
    if (permErr) return permErr

    const parsed = await parseJsonBody<{ from_membership_id?: string; to_membership_id?: string }>(request)
    if (parsed.error) return parsed.error
    const { from_membership_id: fromId, to_membership_id: toId } = parsed.body
    if (!fromId || !toId || !isValidUUID(fromId) || !isValidUUID(toId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "from/to_membership_id required" }, { status: 400 })
    }
    if (fromId === toId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "from === to" }, { status: 400 })
    }

    const sb = getServiceClient()

    // 1. 두 hostess 조회 + 같은 매장 검증
    const { data: rows } = await sb.from("hostesses")
      .select("id, membership_id, name, store_uuid, is_active, deleted_at")
      .in("membership_id", [fromId, toId])
    if (!rows || rows.length !== 2) {
      return NextResponse.json({ error: "HOSTESS_NOT_FOUND", message: "둘 다 조회 실패" }, { status: 404 })
    }
    const fromH = rows.find(r => r.membership_id === fromId)!
    const toH = rows.find(r => r.membership_id === toId)!
    if (fromH.store_uuid !== toH.store_uuid) {
      return NextResponse.json({ error: "STORE_MISMATCH", message: "매장 다르면 병합 불가" }, { status: 400 })
    }
    if (!auth.is_super_admin && fromH.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }
    if (fromH.deleted_at || toH.deleted_at) {
      return NextResponse.json({ error: "ALREADY_DELETED" }, { status: 409 })
    }

    // 2. 이관: session_participants
    const { data: movedParts } = await sb.from("session_participants")
      .update({ membership_id: toId })
      .eq("membership_id", fromId)
      .select("id")
    const partCount = (movedParts ?? []).length

    // 3. transfer_requests
    const { data: movedTrs } = await sb.from("transfer_requests")
      .update({ hostess_membership_id: toId })
      .eq("hostess_membership_id", fromId)
      .select("id")
    const trCount = (movedTrs ?? []).length

    // 4. chat_participants — from 을 to 로 · 중복 있으면 from 만 삭제
    const { data: fromChatRows } = await sb.from("chat_participants")
      .select("id, chat_room_id").eq("membership_id", fromId)
    let chatMoved = 0
    for (const c of (fromChatRows ?? [])) {
      // to 가 이미 그 chat_room 에 있으면 from row 삭제만
      const { data: existTo } = await sb.from("chat_participants")
        .select("id").eq("chat_room_id", c.chat_room_id).eq("membership_id", toId).is("removed_at", null).maybeSingle()
      if (existTo) {
        await sb.from("chat_participants").delete().eq("id", c.id)
      } else {
        await sb.from("chat_participants").update({ membership_id: toId }).eq("id", c.id)
        chatMoved++
      }
    }

    // 5. alias_learnings.resolved_id
    try {
      await sb.from("alias_learnings")
        .update({ resolved_id: toId })
        .eq("resolved_type", "hostess").eq("resolved_id", fromId)
    } catch { /* alias 테이블 없음 */ }

    // 6. from soft-delete
    const nowIso = new Date().toISOString()
    await sb.from("hostesses").update({
      deleted_at: nowIso, is_active: false,
    }).eq("id", fromH.id)
    await sb.from("store_memberships").update({
      deleted_at: nowIso, status: "revoked",
    }).eq("id", fromId)

    // 7. audit (session_id 없이 hostess entity 단위)
    void writeSessionAudit(sb, {
      auth,
      // session_id 필수 signature 우회 · 병합은 세션 컨텍스트 없음.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session_id: undefined as any,
      entity_table: "hostesses",
      entity_id: fromH.id,
      action: "hostess_merged",
      before: { from_membership_id: fromId, name: fromH.name },
      after: { to_membership_id: toId, moved_participants: partCount },
    }).catch(() => { /* silent */ })

    return NextResponse.json({
      ok: true,
      from_membership_id: fromId,
      to_membership_id: toId,
      moved_participants: partCount,
      moved_transfers: trCount,
      moved_chat_rows: chatMoved,
      name: fromH.name,
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
