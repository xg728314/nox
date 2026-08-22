/**
 * Sprint 1 (2026-07-29):
 * POST /api/hostesses/provisional — 미등록 아가씨 정식 승격
 *
 * 흐름:
 *   1. 임시 profile 생성 (auth.users X · profiles 만 · email null 허용은 스키마 확인)
 *   2. store_memberships (role=hostess, status=approved) 생성
 *   3. hostesses 로우 생성
 *   4. 과거 external_name 매칭 세션 참여자에 membership_id 소급 (optional)
 *   5. alias_learnings 에 등록 (from_text → resolved)
 *
 * body:
 *   {
 *     name: string,
 *     store_uuid: string,
 *     manager_membership_id?: string,
 *     external_name_alias?: string,   // 이 이름으로 파싱된 것들 (지스 → 지수)
 *     backfill_participant_ids?: string[]  // 소급 매핑할 external_name 세션 참여자
 *   }
 */
import crypto from "crypto"
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string
      store_uuid?: string
      manager_membership_id?: string
      external_name_alias?: string
      backfill_participant_ids?: string[]
    }
    const name = body.name?.trim() || ""
    const storeUuid = body.store_uuid ?? auth.store_uuid
    if (!name) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name required" }, { status: 400 })
    }
    if (!isValidUUID(storeUuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "store_uuid required" }, { status: 400 })
    }

    // scope: super_admin OR same store OR (owner/manager + 같은 건물 5-8F 매장)
    //   R-cross-store-provision (2026-08-23): 채팅 파싱에서 다른 매장 언급 시
    //   (예: 마블 owner 가 "신세계 지뮌 셔 완메" 입력) 자동 provisioning 이 필요.
    //   실 운영: 실장들이 서로 대신 등록하는 케이스 많음. 같은 건물 (5-8F) 매장이면
    //   owner/manager 도 provision 가능하게 허용. 완전 외부 매장은 여전히 차단.
    if (!auth.is_super_admin && storeUuid !== auth.store_uuid) {
      // 같은 건물 5-8F 매장인지 확인
      const sb2 = getServiceClient()
      const { data: targetStore } = await sb2
        .from("stores")
        .select("floor")
        .eq("id", storeUuid)
        .maybeSingle()
      const floor = (targetStore as { floor: number } | null)?.floor ?? null
      const isSameBuilding = floor !== null && floor >= 5 && floor <= 8
      const isTrustedRole = auth.role === "owner" || auth.role === "manager"
      if (!isSameBuilding || !isTrustedRole) {
        return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
      }
    }

    const sb = getServiceClient()

    // 1) profile 생성 (임시)
    //    profiles 스키마 (002_actual_schema.sql): id UUID NOT NULL PRIMARY KEY (no default) ·
    //      full_name · phone · nickname · is_active · timestamps · deleted_at.
    //    role/email 컬럼 없음. id 는 명시 생성 필수 (auth trigger 안 거침).
    //    R-provisional-fix (2026-08-23): 기존 코드가 role: "hostess" 삽입 → 무조건 실패했음.
    const { data: prof, error: profErr } = await sb
      .from("profiles")
      .insert({
        id: crypto.randomUUID(),
        full_name: name,
      })
      .select("id, full_name")
      .single()
    if (profErr || !prof) {
      return NextResponse.json(
        { error: "PROFILE_CREATE_FAILED", message: profErr?.message ?? "unknown" },
        { status: 500 },
      )
    }

    // 2) store_memberships 생성
    const { data: mem, error: memErr } = await sb
      .from("store_memberships")
      .insert({
        profile_id: (prof as { id: string }).id,
        store_uuid: storeUuid,
        role: "hostess",
        status: "approved",
        is_primary: true,
      })
      .select("id, store_uuid")
      .single()
    if (memErr || !mem) {
      return NextResponse.json(
        { error: "MEMBERSHIP_CREATE_FAILED", message: memErr?.message ?? "unknown" },
        { status: 500 },
      )
    }

    // 3) hostesses 로우
    const memId = (mem as { id: string }).id
    const { data: hostess, error: hErr } = await sb
      .from("hostesses")
      .insert({
        store_uuid: storeUuid,
        membership_id: memId,
        manager_membership_id: body.manager_membership_id ?? null,
        name,
        is_active: true,
      })
      .select("id")
      .single()
    if (hErr) {
      // best-effort · membership 은 이미 생성됨
      // eslint-disable-next-line no-console
      console.warn("[provisional] hostess row failed:", hErr.message)
    }

    // 4) 소급 매핑 (external_name 참여자 → membership_id)
    let backfillCount = 0
    if (Array.isArray(body.backfill_participant_ids) && body.backfill_participant_ids.length > 0) {
      const ids = body.backfill_participant_ids.filter(isValidUUID)
      if (ids.length > 0) {
        const { error: bfErr, count } = await sb
          .from("session_participants")
          .update({ membership_id: memId })
          .in("id", ids)
          .is("membership_id", null)
        if (!bfErr) backfillCount = count ?? ids.length
      }
    }

    // 5) alias_learnings (from_text = 파싱된 원문 alias · resolved = 정식 이름)
    //    scope=store (매장 안에서만 이 매핑 자동 적용)
    if (body.external_name_alias && body.external_name_alias.trim() !== name) {
      try {
        await sb
          .from("alias_learnings")
          .upsert({
            scope: "store",
            scope_id: storeUuid,
            from_text: body.external_name_alias.trim(),
            resolved_type: "hostess",
            resolved_id: memId,
            resolved_value: name,
            confirmed_count: 1,
            last_used_at: new Date().toISOString(),
          }, {
            onConflict: "scope,scope_id,from_text,resolved_type",
            ignoreDuplicates: false,
          })
      } catch { /* alias table 미존재 · migration 174 미apply */ }
    }

    return NextResponse.json({
      membership_id: memId,
      profile_id: (prof as { id: string }).id,
      hostess_id: (hostess as { id?: string } | null)?.id ?? null,
      name,
      store_uuid: storeUuid,
      backfilled_participants: backfillCount,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
