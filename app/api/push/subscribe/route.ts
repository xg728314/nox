/**
 * POST /api/push/subscribe
 * DELETE /api/push/subscribe
 *
 * Web Push subscription 등록/해제.
 * 브라우저 registration.pushManager.subscribe() 결과를 그대로 저장.
 *
 * Body (POST):
 *   {
 *     endpoint: string,
 *     keys: { p256dh: string, auth: string },
 *     user_agent?: string
 *   }
 *
 * Body (DELETE):
 *   { endpoint: string }
 *
 * 권한: 로그인 사용자 본인만.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
      user_agent?: string
    }
    if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "endpoint + keys.{p256dh,auth} required" },
        { status: 400 },
      )
    }
    const supabase = getServiceClient()
    const nowIso = new Date().toISOString()
    // upsert — 이미 있는 endpoint 면 last_seen_at 만 갱신
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: auth.user_id,
          endpoint: body.endpoint,
          p256dh_key: body.keys.p256dh,
          auth_key: body.keys.auth,
          user_agent: body.user_agent ?? null,
          last_seen_at: nowIso,
        },
        { onConflict: "user_id,endpoint" },
      )
    if (error) {
      return NextResponse.json(
        { error: "UPSERT_FAILED", message: error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as { endpoint?: string }
    if (!body.endpoint) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", auth.user_id)
      .eq("endpoint", body.endpoint)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
