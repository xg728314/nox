/**
 * POST /api/nfc/scan
 *
 * R-nfc-phase3 (2026-07-29): NFC 아크릴 태그 터치 진입점.
 *   body: { tag_uuid: string }
 *
 * 흐름:
 *   1. tag_uuid → room_nfc_tags 조회 (active)
 *   2. auth → actor_membership_id
 *   3. Debounce: 같은 (actor, tag) 15초 이내 재요청 → 기존 이벤트 반환 (INSERT 없음)
 *   4. tag_type='room' + active 세션 존재 → session/participant 자동 매칭
 *   5. nfc_scan_events INSERT (status=pending)
 *   6. 응답: 이벤트 상세 (클라이언트가 확인/취소 UI 렌더)
 *
 *   1분 auto-confirm 은 별도 cron: POST /api/nfc/events/auto-confirm
 *   실시간 실장 알림은 Supabase Realtime (chat_participants 참여자 통지)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

const DEBOUNCE_SECONDS = 15

type TagRow = {
  id: string
  tag_uuid: string
  store_uuid: string
  room_uuid: string | null
  tag_type: string
  label: string
  is_active: boolean
  deactivated_at: string | null
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const body = (await request.json().catch(() => ({}))) as { tag_uuid?: string }
    const tagUuid = body.tag_uuid
    if (!tagUuid || !isValidUUID(tagUuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "tag_uuid required" }, { status: 400 })
    }

    const sb = getServiceClient()

    // 1) 태그 조회
    const { data: tagData, error: tagErr } = await sb
      .from("room_nfc_tags")
      .select("id, tag_uuid, store_uuid, room_uuid, tag_type, label, is_active, deactivated_at")
      .eq("tag_uuid", tagUuid)
      .maybeSingle()
    if (tagErr) {
      if ((tagErr as { code?: string }).code === "42P01") {
        return NextResponse.json(
          { error: "MIGRATION_PENDING", message: "NFC 시스템은 database migration 173 apply 후 활성됩니다." },
          { status: 503 },
        )
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: tagErr.message }, { status: 500 })
    }
    const tag = tagData as TagRow | null
    if (!tag || !tag.is_active || tag.deactivated_at) {
      return NextResponse.json({ error: "TAG_INACTIVE", message: "태그를 찾을 수 없거나 비활성 상태." }, { status: 404 })
    }

    // 2) Debounce — 같은 (actor, tag) 15초 이내 재스캔 시 기존 이벤트 반환
    const debounceIso = new Date(Date.now() - DEBOUNCE_SECONDS * 1000).toISOString()
    const { data: recent } = await sb
      .from("nfc_scan_events")
      .select("id, status, session_id, participant_id, scanned_at")
      .eq("actor_membership_id", auth.membership_id)
      .eq("tag_id", tag.id)
      .gte("scanned_at", debounceIso)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent) {
      return NextResponse.json({
        event: recent,
        tag: { tag_type: tag.tag_type, label: tag.label, room_uuid: tag.room_uuid, store_uuid: tag.store_uuid },
        debounced: true,
      })
    }

    // 3) tag_type='room' 이면 active session 자동 매칭
    let sessionId: string | null = null
    let participantId: string | null = null
    if (tag.tag_type === "room" && tag.room_uuid) {
      const { data: sess } = await sb
        .from("room_sessions")
        .select("id")
        .eq("room_uuid", tag.room_uuid)
        .eq("status", "active")
        .is("archived_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (sess) {
        sessionId = (sess as { id: string }).id
        // actor 가 그 세션에 이미 참여자로 등록됐는지 확인 (있으면 participant_id 연결)
        const { data: part } = await sb
          .from("session_participants")
          .select("id")
          .eq("session_id", sessionId)
          .eq("membership_id", auth.membership_id)
          .eq("status", "active")
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle()
        if (part) participantId = (part as { id: string }).id
      }
    }

    // 4) 이벤트 INSERT
    const { data: ins, error: insErr } = await sb
      .from("nfc_scan_events")
      .insert({
        tag_id: tag.id,
        tag_uuid: tag.tag_uuid,
        store_uuid: tag.store_uuid,
        room_uuid: tag.room_uuid,
        tag_type: tag.tag_type,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        session_id: sessionId,
        participant_id: participantId,
        status: "pending",
      })
      .select("id, status, session_id, participant_id, scanned_at")
      .single()
    if (insErr || !ins) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr?.message ?? "unknown" }, { status: 500 })
    }

    // Realtime broadcast 는 Supabase 가 자동 (nfc_scan_events 테이블 subscribe 시)
    return NextResponse.json({
      event: ins,
      tag: {
        tag_type: tag.tag_type,
        label: tag.label,
        room_uuid: tag.room_uuid,
        store_uuid: tag.store_uuid,
      },
      debounced: false,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
