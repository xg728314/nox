/**
 * /api/service-calls — 방 서비스 콜 (안주/술/담배/기타)
 * POST: 실장이 방에서 콜 발생
 * GET:  매장별 대기 콜 목록 (웨이터/카운터 대시보드)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { isValidUUID } from "@/lib/validation"

const VALID_TYPES = ["menu", "drink", "smoke", "temp", "blanket", "ashtray", "mic", "battery", "water", "other"]

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const parsed = await parseJsonBody<{ session_id?: string; request_type?: string; detail?: string }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    if (!b.session_id || !isValidUUID(b.session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id required" }, { status: 400 })
    }
    if (!b.request_type || !VALID_TYPES.includes(b.request_type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `request_type must be one of ${VALID_TYPES.join(",")}` }, { status: 400 })
    }

    const sb = getServiceClient()
    // 세션 lookup (store_uuid + room_uuid 채우기)
    const { data: sess } = await sb.from("room_sessions")
      .select("id, store_uuid, room_uuid, status").eq("id", b.session_id).maybeSingle()
    if (!sess) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    if (sess.status !== "active") return NextResponse.json({ error: "SESSION_NOT_ACTIVE" }, { status: 409 })

    // 매장 scope 검증
    if (!auth.is_super_admin && sess.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const { data: created, error } = await sb.from("room_service_calls").insert({
      session_id: b.session_id,
      store_uuid: sess.store_uuid,
      room_uuid: sess.room_uuid,
      request_type: b.request_type,
      detail: typeof b.detail === "string" ? b.detail.slice(0, 300) : null,
      requested_by_membership_id: auth.membership_id,
    }).select("id").single()

    if (error) return NextResponse.json({ error: "CREATE_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ id: (created as { id: string }).id })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const status = url.searchParams.get("status") ?? "active"
    const sb = getServiceClient()

    let query = sb.from("room_service_calls")
      .select("id, session_id, store_uuid, room_uuid, request_type, detail, status, requested_by_membership_id, assigned_to_membership_id, progress_at, completed_at, created_at")
      .eq("store_uuid", auth.store_uuid)
      .order("created_at", { ascending: false })
      .limit(100)

    if (status === "active") {
      query = query.in("status", ["requested", "in_progress"])
    } else if (["requested", "in_progress", "done", "cancelled"].includes(status)) {
      query = query.eq("status", status)
    }

    const { data: rows } = await query
    // room_no 매핑
    const roomIds = [...new Set((rows ?? []).map(r => r.room_uuid).filter(Boolean))]
    const { data: rooms } = roomIds.length
      ? await sb.from("rooms").select("id, room_no").in("id", roomIds)
      : { data: [] }
    const roomMap = new Map((rooms ?? []).map(r => [r.id, r.room_no]))

    const items = (rows ?? []).map(r => ({
      ...r,
      room_no: r.room_uuid ? roomMap.get(r.room_uuid) : null,
    }))

    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
