/**
 * GET /api/community/posts/[id]/comments   댓글 목록
 * POST /api/community/posts/[id]/comments  댓글 작성
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
  const supabase = getServiceClient()
  const { data } = await supabase
    .from("community_comments")
    .select("id, author_user_id, author_nickname, body, parent_comment_id, like_count, created_at")
    .eq("post_id", id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true })
  return NextResponse.json({ comments: data ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as {
      body?: string
      parent_comment_id?: string
      nickname?: string
    }
    if (!body.body?.trim()) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    let nickname = body.nickname?.trim() ?? null
    if (!nickname) {
      const { data: pp } = await supabase
        .from("user_public_profiles")
        .select("nickname")
        .eq("user_id", auth.user_id)
        .maybeSingle()
      nickname = (pp as { nickname: string } | null)?.nickname ?? null
    }
    const { data, error } = await supabase
      .from("community_comments")
      .insert({
        post_id: id,
        author_user_id: auth.user_id,
        author_nickname: nickname,
        body: body.body.trim(),
        parent_comment_id: body.parent_comment_id ?? null,
      })
      .select("id")
      .single()
    if (error) {
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    // comment_count 증가
    const { data: cur } = await supabase
      .from("community_posts")
      .select("comment_count")
      .eq("id", id)
      .maybeSingle()
    if (cur) {
      await supabase
        .from("community_posts")
        .update({ comment_count: (cur as { comment_count: number }).comment_count + 1 })
        .eq("id", id)
    }
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
