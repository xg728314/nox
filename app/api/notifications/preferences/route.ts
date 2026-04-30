import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/notifications/preferences
 *   본인 운영자의 알림 설정 조회. row 없으면 default.
 *
 * PUT /api/notifications/preferences
 *   body 의 toggle 값 upsert.
 *
 * R-Staff-Board (2026-05-01): 운영자 의도 "알림 끄고 켜기".
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const DEFAULTS = {
  board_new_request: true,
  board_response: true,
  sound_enabled: true,
  desktop_notification: false,
  push_enabled: false,
  kakao_alimtalk: false,
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = supa()
    const { data } = await supabase
      .from("notification_preferences")
      .select(
        "board_new_request, board_response, sound_enabled, desktop_notification, push_enabled, kakao_alimtalk, updated_at",
      )
      .eq("membership_id", auth.membership_id)
      .maybeSingle()
    return NextResponse.json({
      preferences: data ?? { ...DEFAULTS, updated_at: null },
      defaults: DEFAULTS,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const next: Record<string, boolean> = {}
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof body[k] === "boolean") next[k] = body[k] as boolean
    }
    if (Object.keys(next).length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "no toggle keys" }, { status: 400 })
    }

    const supabase = supa()
    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          membership_id: auth.membership_id,
          ...next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "membership_id" },
      )
      .select()
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: "UPSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ preferences: data })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
