/**
 * POST /api/community/like  { target_type: 'post'|'comment'|'ad', target_id }
 *   토글 (있으면 삭제, 없으면 추가). like_count 원자적 갱신.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

const TABLE_BY_TYPE: Record<string, string> = {
  post: "community_posts",
  comment: "community_comments",
  ad: "ads",
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      target_type?: string
      target_id?: string
    }
    const type = body.target_type ?? ""
    const id = body.target_id ?? ""
    if (!TABLE_BY_TYPE[type] || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    // 이미 있으면 삭제
    const { data: existing } = await supabase
      .from("community_likes")
      .select("id")
      .eq("user_id", auth.user_id)
      .eq("target_type", type)
      .eq("target_id", id)
      .maybeSingle()
    const table = TABLE_BY_TYPE[type]
    if (existing) {
      await supabase.from("community_likes").delete().eq("id", (existing as { id: string }).id)
      const { data: cur } = await supabase.from(table).select("like_count").eq("id", id).maybeSingle()
      const newCount = Math.max(0, ((cur as { like_count: number } | null)?.like_count ?? 1) - 1)
      await supabase.from(table).update({ like_count: newCount }).eq("id", id)
      return NextResponse.json({ liked: false, like_count: newCount })
    } else {
      await supabase.from("community_likes").insert({
        user_id: auth.user_id,
        target_type: type,
        target_id: id,
      })
      const { data: cur } = await supabase.from(table).select("like_count").eq("id", id).maybeSingle()
      const newCount = ((cur as { like_count: number } | null)?.like_count ?? 0) + 1
      await supabase.from(table).update({ like_count: newCount }).eq("id", id)
      return NextResponse.json({ liked: true, like_count: newCount })
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
