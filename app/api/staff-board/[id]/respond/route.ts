import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/staff-board/[id]/respond
 *
 * 다른 매장 카드에 응답. body:
 *   { response_kind: 'confirm' | 'question' | 'decline',
 *     message?: string,
 *     suggested_hostess_membership_id?: string }
 *
 * 본인 매장 카드에는 응답 불가.
 * owner / manager / waiter 만 응답 가능.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RESPONDER_ROLES = ["owner", "manager", "waiter"] as const
const VALID_KINDS = ["confirm", "question", "decline"] as const

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!(RESPONDER_ROLES as readonly string[]).includes(auth.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "owner / manager / waiter 만 응답할 수 있습니다." },
        { status: 403 },
      )
    }
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      response_kind?: string
      message?: string
      suggested_hostess_membership_id?: string | null
    }
    if (!(VALID_KINDS as readonly string[]).includes(body.response_kind ?? "")) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid response_kind" }, { status: 400 })
    }
    const message = typeof body.message === "string" ? body.message.slice(0, 200) : null
    const suggested =
      typeof body.suggested_hostess_membership_id === "string" &&
      /^[0-9a-f-]{36}$/.test(body.suggested_hostess_membership_id)
        ? body.suggested_hostess_membership_id
        : null

    const supabase = supa()

    const { data: row } = await supabase
      .from("staff_request_board")
      .select("id, store_uuid, status")
      .eq("id", id)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const r = row as { id: string; store_uuid: string; status: string }
    if (r.store_uuid === auth.store_uuid) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "본인 매장 카드에는 응답할 수 없습니다." },
        { status: 403 },
      )
    }
    if (r.status !== "active") {
      return NextResponse.json({ error: "NOT_ACTIVE" }, { status: 409 })
    }

    const { data: inserted, error } = await supabase
      .from("staff_request_responses")
      .insert({
        request_id: id,
        responder_store_uuid: auth.store_uuid,
        responder_user_id: auth.user_id,
        responder_membership_id: auth.membership_id,
        response_kind: body.response_kind,
        message,
        suggested_hostess_membership_id: suggested,
      })
      .select()
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ item: inserted })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/** GET: 본 카드에 달린 응답 list (요청자 매장 또는 본인 응답한 사람만). */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await context.params
    const supabase = supa()

    const { data: row } = await supabase
      .from("staff_request_board")
      .select("id, store_uuid")
      .eq("id", id)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const r = row as { id: string; store_uuid: string }

    let q = supabase
      .from("staff_request_responses")
      .select("id, request_id, responder_store_uuid, response_kind, message, suggested_hostess_membership_id, responded_at, matched_at")
      .eq("request_id", id)
      .order("responded_at", { ascending: false })

    // 권한: 요청자 매장만 모든 응답 조회. 그 외는 본인 매장 응답만 (privacy).
    if (r.store_uuid !== auth.store_uuid) {
      q = q.eq("responder_store_uuid", auth.store_uuid)
    }

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }

    // 매장명 lookup
    const rows = (data ?? []) as Array<{ id: string; responder_store_uuid: string } & Record<string, unknown>>
    const sids = Array.from(new Set(rows.map((x) => x.responder_store_uuid)))
    const nameMap = new Map<string, string>()
    if (sids.length > 0) {
      const { data: stores } = await supabase
        .from("stores")
        .select("id, store_name, floor_no")
        .in("id", sids)
      for (const s of (stores ?? []) as Array<{ id: string; store_name: string; floor_no: number | null }>) {
        nameMap.set(s.id, `${s.floor_no ? `${s.floor_no}층 ` : ""}${s.store_name}`)
      }
    }

    return NextResponse.json({
      items: rows.map((x) => ({
        ...x,
        responder_label: nameMap.get(x.responder_store_uuid) ?? x.responder_store_uuid.slice(0, 8),
      })),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
