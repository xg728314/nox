/**
 * /api/choice-requests
 *
 * GET  — 매장 pending 초이스 요청 목록 (sticky bar 용)
 * POST — 신규 초이스 요청 생성 · 도배 방지 (30초 dedup)
 *
 * R-choice-request (2026-08-23):
 *   실장이 카톡에 "3인 하퍼 초이스" 반복 도배 → 서버가 도배 방지.
 *   30초 이내 같은 매장 · 같은 (categories+party_size) 요청 있으면 skip · 기존 재활성.
 *   매칭 완료 (session insert) 시 status=matched 자동 처리 (별도 훅).
 *
 * body (POST):
 *   {
 *     store_uuid?: string,             // 기본: auth.store_uuid
 *     categories: string[],            // ["퍼블릭","셔츠","하퍼"] 중
 *     party_size: number,              // 손님 인원 수
 *     raw_text?: string,               // 원문 채팅
 *     source_chat_message_id?: string,
 *   }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

const DEDUP_WINDOW_SEC = 30

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const storeUuid = url.searchParams.get("store_uuid") || auth.store_uuid

    const sb = getServiceClient()
    // pending + not expired
    const nowIso = new Date().toISOString()
    const { data: rows } = await sb
      .from("choice_requests")
      .select("id, store_uuid, party_size, categories, raw_text, status, requested_by_membership_id, source_chat_message_id, matched_session_id, matched_at, expires_at, created_at")
      .eq("store_uuid", storeUuid)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(30)

    return NextResponse.json({
      requests: rows ?? [],
      count: (rows ?? []).length,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "초이스 요청은 실장/사장만 가능합니다." }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      store_uuid?: string
      categories?: string[]
      party_size?: number
      raw_text?: string
      source_chat_message_id?: string
    }
    const storeUuid = body.store_uuid || auth.store_uuid
    const categories = Array.isArray(body.categories)
      ? body.categories.filter((c) => ["퍼블릭", "셔츠", "하퍼"].includes(c))
      : []
    const partySize = Math.max(0, Math.min(30, Number(body.party_size ?? 0)))
    if (categories.length === 0 && partySize === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "categories 또는 party_size 중 하나 필수" }, { status: 400 })
    }

    // Same-building scope check (owner/manager 는 5-8F 매장 대신 요청 가능)
    if (!auth.is_super_admin && storeUuid !== auth.store_uuid) {
      const sb0 = getServiceClient()
      const { data: st } = await sb0.from("stores").select("floor").eq("id", storeUuid).maybeSingle()
      const floor = (st as { floor: number } | null)?.floor ?? null
      if (!(floor !== null && floor >= 5 && floor <= 8)) {
        return NextResponse.json({ error: "SCOPE_FORBIDDEN", message: "다른 매장 요청 불가" }, { status: 403 })
      }
    }

    const sb = getServiceClient()

    // R-dedup (2026-08-23): 30초 window 내 같은 매장 · 같은 categories+party_size 있으면 skip.
    //   `expires_at` 갱신 (재활성) · 도배 방지.
    const windowIso = new Date(Date.now() - DEDUP_WINDOW_SEC * 1000).toISOString()
    const catsSorted = [...categories].sort()
    const { data: recent } = await sb
      .from("choice_requests")
      .select("id, categories, party_size, expires_at")
      .eq("store_uuid", storeUuid)
      .eq("status", "pending")
      .gte("created_at", windowIso)

    const dupe = ((recent ?? []) as Array<{ id: string; categories: string[]; party_size: number }>)
      .find((r) => r.party_size === partySize &&
        JSON.stringify([...(r.categories || [])].sort()) === JSON.stringify(catsSorted))

    if (dupe) {
      // 재활성 (expires_at 갱신)
      const newExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString()
      await sb
        .from("choice_requests")
        .update({ expires_at: newExpiry, updated_at: new Date().toISOString() })
        .eq("id", dupe.id)
      return NextResponse.json({ ok: true, deduped: true, request_id: dupe.id, message: "30초 내 동일 요청 · 재활성" })
    }

    // 신규 INSERT
    const { data: created, error: cErr } = await sb
      .from("choice_requests")
      .insert({
        store_uuid: storeUuid,
        party_size: partySize,
        categories: catsSorted,
        raw_text: body.raw_text ?? null,
        status: "pending",
        requested_by_membership_id: auth.membership_id,
        source_chat_message_id: body.source_chat_message_id ?? null,
      })
      .select("id, expires_at")
      .single()
    if (cErr || !created) {
      // migration 176 미apply · 42P01/PGRST205 시 silent (앱 계속 작동)
      const code = (cErr as { code?: string } | null)?.code
      if (code === "42P01" || code === "PGRST205") {
        return NextResponse.json({ ok: true, migration_pending: true, message: "choice_requests 테이블 미apply · 스킵" })
      }
      return NextResponse.json({ error: "INSERT_FAILED", message: cErr?.message ?? "unknown" }, { status: 500 })
    }

    // audit best-effort
    try {
      await sb.from("audit_events").insert({
        store_uuid: storeUuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "choice_requests",
        entity_id: (created as { id: string }).id,
        action: "choice_request_created",
        before: null,
        after: { party_size: partySize, categories: catsSorted, raw_text: body.raw_text },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: true,
      request_id: (created as { id: string }).id,
      expires_at: (created as { expires_at: string }).expires_at,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
