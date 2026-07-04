/**
 * POST /api/push/send
 *
 * 특정 사용자 (또는 본인) 에게 push notification 전송.
 * 테스트 + 관리자 트리거용.
 *
 * Body:
 *   {
 *     target_user_id?: string,   // 생략 시 본인
 *     title: string,
 *     body: string,
 *     url?: string,
 *     tag?: string,
 *     data?: object
 *   }
 *
 * 권한:
 *   - target_user_id 없거나 본인 = 항상 허용 (본인 기기에 test push)
 *   - target_user_id 다른 사람 = super_admin 만
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { sendPushToUser } from "@/lib/push/send"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      target_user_id?: string
      title?: string
      body?: string
      url?: string
      tag?: string
      icon?: string
      data?: Record<string, unknown>
    }
    if (!body.title || !body.body) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "title + body required" },
        { status: 400 },
      )
    }
    const target = body.target_user_id ?? auth.user_id
    if (target !== auth.user_id && !auth.is_super_admin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const result = await sendPushToUser(target, {
      title: body.title,
      body: body.body,
      url: body.url,
      tag: body.tag,
      icon: body.icon,
      data: body.data,
    })
    return NextResponse.json({ ...result, sent: true })
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
