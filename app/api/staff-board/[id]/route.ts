import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * DELETE /api/staff-board/[id]
 *   본인 매장 카드 취소 (status='cancelled').
 *   다른 매장 카드는 차단.
 *
 * PATCH /api/staff-board/[id]
 *   status='fulfilled' 처리 (요청자가 매칭 받아들임).
 *   body: { fulfilled_by_store_uuid }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

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
    if (r.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "본인 매장 카드만 취소할 수 있습니다." },
        { status: 403 },
      )
    }
    if (r.status !== "active") {
      return NextResponse.json({ error: "NOT_ACTIVE", message: "이미 종료된 카드입니다." }, { status: 409 })
    }

    const { error } = await supabase
      .from("staff_request_board")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", id)
    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      fulfilled_by_store_uuid?: string
    }
    const fulfilledBy = body.fulfilled_by_store_uuid
    if (!fulfilledBy || !/^[0-9a-f-]{36}$/.test(fulfilledBy)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

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
    if (r.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "본인 매장 카드만 매칭 확정할 수 있습니다." },
        { status: 403 },
      )
    }
    if (r.status !== "active") {
      return NextResponse.json({ error: "NOT_ACTIVE" }, { status: 409 })
    }

    const { error } = await supabase
      .from("staff_request_board")
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
        fulfilled_by_store_uuid: fulfilledBy,
      })
      .eq("id", id)
    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
