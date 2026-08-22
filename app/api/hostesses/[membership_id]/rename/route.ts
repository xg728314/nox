/**
 * PATCH /api/hostesses/[membership_id]/rename
 *
 * 아가씨 이름 수정. 오탈자 즉시 정정용.
 *
 * 권한:
 *   - super_admin: 전체
 *   - owner/manager (같은 매장 · 그 아가씨 소속): 가능
 *   - hostess 본인 (자기 membership): 가능
 *
 * body: { new_name: string, reason?: string }
 *
 * 부수 효과:
 *   - profiles.full_name 갱신
 *   - alias_learnings 에 old_name → new_name 학습 (다음 파싱부터 자동 매칭)
 *   - audit_events 로그
 *
 * R-rename (2026-08-23)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id } = await params
    if (!isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id required" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as { new_name?: string; reason?: string }
    const newName = body.new_name?.trim() || ""
    if (!newName) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "new_name required" }, { status: 400 })
    }
    if (newName.length > 40) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "new_name too long" }, { status: 400 })
    }

    const sb = getServiceClient()

    // 대상 membership 조회 (store_uuid, profile_id, role, 현재 이름)
    const { data: memData, error: memErr } = await sb
      .from("store_memberships")
      .select("id, store_uuid, profile_id, role, status, deleted_at")
      .eq("id", membership_id)
      .maybeSingle()
    if (memErr) {
      return NextResponse.json({ error: "QUERY_FAILED", message: memErr.message }, { status: 500 })
    }
    const mem = memData as {
      id: string; store_uuid: string; profile_id: string;
      role: string; status: string; deleted_at: string | null
    } | null
    if (!mem) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (mem.deleted_at) return NextResponse.json({ error: "ALREADY_DELETED" }, { status: 409 })
    if (mem.role !== "hostess") {
      return NextResponse.json({ error: "NOT_HOSTESS", message: "이 API 는 hostess membership 만 수정 가능" }, { status: 400 })
    }

    // 권한 판정
    // - super_admin: OK
    // - 본인 (자기 membership_id): OK
    // - 같은 매장 owner/manager: OK
    const isSelf = auth.membership_id === membership_id
    const isSameStoreLeader =
      (auth.role === "owner" || auth.role === "manager") && auth.store_uuid === mem.store_uuid
    if (!auth.is_super_admin && !isSelf && !isSameStoreLeader) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    // 기존 이름 조회 (alias 학습용)
    const { data: profData } = await sb
      .from("profiles")
      .select("full_name")
      .eq("id", mem.profile_id)
      .maybeSingle()
    const oldName = (profData as { full_name: string | null } | null)?.full_name ?? ""

    if (oldName.trim() === newName) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    // 1) profiles 업데이트
    const { error: updErr } = await sb
      .from("profiles")
      .update({ full_name: newName, updated_at: new Date().toISOString() })
      .eq("id", mem.profile_id)
    if (updErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updErr.message }, { status: 500 })
    }

    // 2) alias_learnings 에 old_name → new_name 학습 (best-effort · migration 174 미apply 시 무시)
    if (oldName && oldName !== newName) {
      try {
        await sb.from("alias_learnings").upsert({
          scope: "store",
          scope_id: mem.store_uuid,
          from_text: oldName,
          resolved_type: "hostess",
          resolved_id: membership_id,
          resolved_value: newName,
          confirmed_count: 1,
          last_used_at: new Date().toISOString(),
        }, { onConflict: "scope,scope_id,from_text,resolved_type" })
      } catch { /* migration 174 미apply · 무시 */ }
    }

    // 3) audit_events (best-effort)
    try {
      await sb.from("audit_events").insert({
        store_uuid: mem.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "profiles",
        entity_id: mem.profile_id,
        action: "hostess_renamed",
        before: { full_name: oldName },
        after: { full_name: newName, reason: body.reason ?? null },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: true,
      membership_id,
      old_name: oldName,
      new_name: newName,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
