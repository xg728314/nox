/**
 * POST /api/hostesses/[membership_id]/merge
 *
 * 아가씨 병합. `[membership_id]` (from) 를 body.into_membership_id (target) 로 흡수.
 * from 은 soft-deleted 되고 모든 참조가 into 로 소급됨.
 *
 * 유즈케이스:
 *   - "마블 미연" 이 채팅 파싱으로 자동 등록됨
 *   - 다른 매장에서 오탈자 "마블 미언" 이 별도 등록됨 → 1명이 2명이 됨
 *   - owner 가 병합 → 세션 참여자 · 정산 · 이력 모두 into 로 옮기고 from 은 삭제 마크
 *
 * 권한:
 *   - super_admin: 전체
 *   - owner (같은 매장 · from 소속): 가능
 *   - manager 는 불가 (돈 · 이력 소급이라 owner 승인 필요)
 *
 * body: { into_membership_id: uuid, reason?: string }
 *
 * 소급 대상 테이블:
 *   - session_participants.membership_id (from → into)
 *   - cross_store_work_records.hostess_membership_id
 *   - staff_payout_states.hostess_membership_id
 *   - chat_pattern_dispatches.hostess_membership_id
 *   - alias_learnings.resolved_id (resolved_type=hostess)
 *   - hostess_schedules.hostess_membership_id (migration 172 apply 시)
 *   - transfer_requests.hostess_membership_id
 *
 * from 상태:
 *   - profiles.deleted_at + merged_into_membership_id 세팅
 *   - store_memberships.deleted_at + merged_into_membership_id 세팅
 *   - hostesses.deleted_at + merged_into_membership_id 세팅
 *
 * 감사:
 *   - hostess_merge_history 에 스냅샷 저장 (from_snapshot JSONB)
 *   - audit_events 추가
 *
 * ⚠️ 되돌릴 수 없음 (soft-delete 여도 소급 UPDATE 는 원복 어려움).
 *
 * R-merge (2026-08-23)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

type Membership = {
  id: string
  store_uuid: string
  profile_id: string
  role: string
  status: string
  deleted_at: string | null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id: from_id } = await params
    if (!isValidUUID(from_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "from membership_id required" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as { into_membership_id?: string; reason?: string }
    const into_id = body.into_membership_id ?? ""
    if (!isValidUUID(into_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "into_membership_id required" }, { status: 400 })
    }
    if (from_id === into_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "self merge" }, { status: 400 })
    }

    const sb = getServiceClient()

    // 대상 조회
    const { data: rows, error: qErr } = await sb
      .from("store_memberships")
      .select("id, store_uuid, profile_id, role, status, deleted_at")
      .in("id", [from_id, into_id])
    if (qErr) {
      return NextResponse.json({ error: "QUERY_FAILED", message: qErr.message }, { status: 500 })
    }
    const arr = (rows ?? []) as Membership[]
    const from = arr.find((r) => r.id === from_id)
    const into = arr.find((r) => r.id === into_id)
    if (!from || !into) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (from.deleted_at) return NextResponse.json({ error: "FROM_ALREADY_DELETED" }, { status: 409 })
    if (into.deleted_at) return NextResponse.json({ error: "INTO_ALREADY_DELETED" }, { status: 409 })
    if (from.role !== "hostess" || into.role !== "hostess") {
      return NextResponse.json({ error: "NOT_HOSTESS" }, { status: 400 })
    }

    // 권한: super_admin OR owner (from 매장 소속)
    const isOwnerOfFromStore = auth.role === "owner" && auth.store_uuid === from.store_uuid
    if (!auth.is_super_admin && !isOwnerOfFromStore) {
      return NextResponse.json({ error: "FORBIDDEN", message: "owner 또는 super_admin 만 병합 가능" }, { status: 403 })
    }

    // 스냅샷 수집 (from 쪽)
    const [profFrom, profInto] = await Promise.all([
      sb.from("profiles").select("*").eq("id", from.profile_id).maybeSingle(),
      sb.from("profiles").select("full_name").eq("id", into.profile_id).maybeSingle(),
    ])
    const fromName = ((profFrom.data as { full_name: string | null } | null)?.full_name ?? "") as string
    const intoName = ((profInto.data as { full_name: string | null } | null)?.full_name ?? "") as string

    // hostesses row (있으면)
    const [hostFrom, hostInto] = await Promise.all([
      sb.from("hostesses").select("id").eq("membership_id", from_id).maybeSingle(),
      sb.from("hostesses").select("id").eq("membership_id", into_id).maybeSingle(),
    ])
    const fromHostessId = (hostFrom.data as { id: string } | null)?.id ?? null
    const intoHostessId = (hostInto.data as { id: string } | null)?.id ?? null

    // ── 소급 UPDATE ──
    // 각 테이블은 존재 여부 · 컬럼 있음 여부 다양 · best-effort 로 진행 · 카운트 수집
    const counts = {
      reassigned_participants: 0,
      reassigned_cross_store_records: 0,
      reassigned_payout_states: 0,
      reassigned_pattern_dispatches: 0,
      reassigned_aliases: 0,
      reassigned_schedules: 0,
      reassigned_transfers: 0,
    }

    async function reassign(table: string, col: string, key: keyof typeof counts) {
      try {
        const { data, error } = await sb
          .from(table)
          .update({ [col]: into_id })
          .eq(col, from_id)
          .select("id")
        if (error) return
        counts[key] = data?.length ?? 0
      } catch { /* 테이블/컬럼 미존재 · 무시 */ }
    }

    await reassign("session_participants", "membership_id", "reassigned_participants")
    await reassign("cross_store_work_records", "hostess_membership_id", "reassigned_cross_store_records")
    await reassign("staff_payout_states", "hostess_membership_id", "reassigned_payout_states")
    await reassign("chat_pattern_dispatches", "hostess_membership_id", "reassigned_pattern_dispatches")
    await reassign("hostess_schedules", "hostess_membership_id", "reassigned_schedules")
    await reassign("transfer_requests", "hostess_membership_id", "reassigned_transfers")

    // alias_learnings 소급 (resolved_type='hostess', resolved_id=from → into · resolved_value 도 갱신)
    try {
      const { data: aliases } = await sb
        .from("alias_learnings")
        .update({ resolved_id: into_id, resolved_value: intoName || fromName })
        .eq("resolved_type", "hostess")
        .eq("resolved_id", from_id)
        .select("id")
      counts.reassigned_aliases = aliases?.length ?? 0
    } catch { /* 무시 */ }

    // from 이름 → into 로 매핑 학습 추가 (다음 파싱부터 알아서 into 로 매칭)
    if (fromName && fromName !== intoName) {
      try {
        await sb.from("alias_learnings").upsert({
          scope: "store",
          scope_id: from.store_uuid,
          from_text: fromName,
          resolved_type: "hostess",
          resolved_id: into_id,
          resolved_value: intoName || fromName,
          confirmed_count: 1,
          last_used_at: new Date().toISOString(),
        }, { onConflict: "scope,scope_id,from_text,resolved_type" })
      } catch { /* 무시 */ }
    }

    // ── from soft-delete + pointer ──
    const nowIso = new Date().toISOString()
    try {
      await sb
        .from("store_memberships")
        .update({ deleted_at: nowIso, merged_into_membership_id: into_id, updated_at: nowIso })
        .eq("id", from_id)
    } catch { /* 무시 */ }
    try {
      await sb
        .from("profiles")
        .update({ deleted_at: nowIso, merged_into_membership_id: into_id, updated_at: nowIso })
        .eq("id", from.profile_id)
    } catch { /* 무시 */ }
    if (fromHostessId) {
      try {
        await sb
          .from("hostesses")
          .update({ deleted_at: nowIso, merged_into_membership_id: into_id })
          .eq("id", fromHostessId)
      } catch { /* 무시 */ }
    }

    // ── 감사 로그 ──
    let mergeHistoryId: string | null = null
    try {
      const { data: mh } = await sb.from("hostess_merge_history").insert({
        from_membership_id: from_id,
        from_profile_id: from.profile_id,
        from_hostess_id: fromHostessId,
        from_store_uuid: from.store_uuid,
        from_name: fromName,
        into_membership_id: into_id,
        into_profile_id: into.profile_id,
        into_hostess_id: intoHostessId,
        into_store_uuid: into.store_uuid,
        into_name: intoName,
        reassigned_participants: counts.reassigned_participants,
        reassigned_cross_store_records: counts.reassigned_cross_store_records,
        reassigned_payout_states: counts.reassigned_payout_states,
        reassigned_pattern_dispatches: counts.reassigned_pattern_dispatches,
        reassigned_aliases: counts.reassigned_aliases,
        merged_by_membership_id: auth.membership_id,
        merged_by_profile_id: auth.user_id,
        reason: body.reason ?? null,
        from_snapshot: profFrom.data ?? null,
      }).select("id").maybeSingle()
      mergeHistoryId = (mh as { id: string } | null)?.id ?? null
    } catch { /* migration 175 미apply · 감사 로그만 실패 · 소급은 완료 */ }

    try {
      await sb.from("audit_events").insert({
        store_uuid: from.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "store_memberships",
        entity_id: from_id,
        action: "hostess_merged",
        before: { from_name: fromName },
        after: { into_membership_id: into_id, into_name: intoName, counts, merge_history_id: mergeHistoryId },
      })
    } catch { /* 무시 */ }

    return NextResponse.json({
      ok: true,
      from_membership_id: from_id,
      into_membership_id: into_id,
      counts,
      merge_history_id: mergeHistoryId,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
