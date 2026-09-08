/**
 * POST /api/chat/tutorial-check
 *
 * R36: 채팅방 첫 진입 시 신입 튜토리얼 필요 여부 판정 + 상태 stamp.
 *
 * body: { chat_room_id: string }
 * 응답: { show_tutorial: boolean, store_name?: string, examples?: string[] }
 *
 * 규칙:
 *   - membership 별 · store 별로 한 번만 발송
 *   - chat_tutorial_seen 에 stamp 있으면 show_tutorial=false
 *   - 첫 요청 시 stamp 추가 후 show_tutorial=true
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const sb = getServiceClient()

    // R36-fix (2026-09-09): stamp 는 사용자가 명시 dismiss 시에만.
    //   여기서는 순수 조회 (idempotent) · React StrictMode 이중 발화에도 안전.
    //   dismiss 는 별도 POST /api/chat/tutorial-dismiss.
    const { data: seen } = await sb.from("chat_tutorial_seen")
      .select("id")
      .eq("membership_id", auth.membership_id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (seen) {
      return NextResponse.json({ show_tutorial: false })
    }

    // 매장 이름 + 매장 규칙 로드
    const { data: store } = await sb.from("stores")
      .select("store_name").eq("id", auth.store_uuid).maybeSingle()
    const { data: settings } = await sb.from("store_settings")
      .select("chat_rules_json").eq("store_uuid", auth.store_uuid).maybeSingle()

    const storeName = (store as { store_name?: string } | null)?.store_name ?? "우리 매장"
    const rules = (settings as { chat_rules_json?: { examples?: string[] } | null } | null)?.chat_rules_json ?? null
    const defaultExamples = [
      `「${storeName} 지연 셔츠 완메」`,
      `「${storeName} 유나 하퍼 스타트」`,
      `「${storeName} 다은 반차3 끝」`,
      `「${storeName} 지수 한개 연장」`,
    ]

    return NextResponse.json({
      show_tutorial: true,
      store_name: storeName,
      examples: rules?.examples ?? defaultExamples,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
