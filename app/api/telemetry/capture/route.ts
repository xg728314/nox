import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/telemetry/capture
 *
 * 2026-04-25: 클라이언트 captureException() 이 서버로 전송 → system_errors DB.
 * 실패 방어: 인증 없어도 501 이 아닌 204 로 응답 (삼킴). 텔레메트리가 앱 동작
 * 을 절대 막으면 안 됨.
 *
 * body: { tag, error_name, error_message, stack, digest, url, user_agent, extra }
 */
export async function POST(request: Request) {
  try {
    // auth 는 best-effort — 없어도 익명 기록 허용 (401/공개 페이지 예외 포함)
    let storeUuid: string | null = null
    let actorId: string | null = null
    let actorRole: string | null = null
    try {
      const auth = await resolveAuthContext(request)
      storeUuid = auth.store_uuid
      actorId = auth.user_id
      actorRole = auth.role
    } catch {
      // anonymous ok
    }

    let body: Record<string, unknown> = {}
    try { body = (await request.json()) as Record<string, unknown> } catch { /* no body ok */ }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return new NextResponse(null, { status: 204 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    await supabase.from("system_errors").insert({
      store_uuid: storeUuid,
      actor_profile_id: actorId,
      actor_role: actorRole,
      tag: typeof body.tag === "string" ? body.tag.slice(0, 100) : null,
      error_name: typeof body.error_name === "string" ? body.error_name.slice(0, 200) : null,
      error_message: typeof body.error_message === "string" ? body.error_message.slice(0, 1000) : null,
      stack: typeof body.stack === "string" ? body.stack.slice(0, 10000) : null,
      digest: typeof body.digest === "string" ? body.digest.slice(0, 100) : null,
      url: typeof body.url === "string" ? body.url.slice(0, 500) : null,
      user_agent: typeof body.user_agent === "string" ? body.user_agent.slice(0, 500) : null,
      extra: body.extra && typeof body.extra === "object" ? body.extra : null,
    })

    return new NextResponse(null, { status: 204 })
  } catch {
    // 텔레메트리 실패가 앱 흐름 막지 않도록 항상 204
    return new NextResponse(null, { status: 204 })
  }
}
