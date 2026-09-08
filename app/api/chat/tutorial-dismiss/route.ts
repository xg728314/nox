/**
 * POST /api/chat/tutorial-dismiss
 *
 * R36 (2026-09-09): 신입 튜토리얼 봇 dismiss stamp.
 *   사용자가 「알겠어요」 클릭 시 · membership+store 별로 한 번만.
 *   UNIQUE constraint · 중복 insert 는 upsert 로 처리.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const sb = getServiceClient()
    // upsert (UNIQUE membership_id+store_uuid) — 중복 무해
    const { error } = await sb.from("chat_tutorial_seen")
      .upsert(
        { membership_id: auth.membership_id, store_uuid: auth.store_uuid },
        { onConflict: "membership_id,store_uuid", ignoreDuplicates: true },
      )
    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
