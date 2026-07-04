/**
 * GET /api/community/posts/[id]      상세 + view_count 증가
 * PATCH /api/community/posts/[id]    본인 게시글 수정
 * DELETE /api/community/posts/[id]   본인 게시글 삭제
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
    .from("community_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  void supabase
    .from("community_posts")
    .update({ view_count: (data as { view_count: number }).view_count + 1 })
    .eq("id", id)
  return NextResponse.json({ post: data })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as {
      title?: string
      body?: string
      image_urls?: string[]
    }
    const supabase = getServiceClient()
    const { data: existing } = await supabase
      .from("community_posts")
      .select("author_user_id")
      .eq("id", id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if ((existing as { author_user_id: string }).author_user_id !== auth.user_id
        && !auth.is_super_admin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.title !== undefined) patch.title = body.title
    if (body.body !== undefined) patch.body = body.body
    if (body.image_urls !== undefined) patch.image_urls = body.image_urls
    await supabase.from("community_posts").update(patch).eq("id", id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    await supabase
      .from("community_posts")
      .update({ is_hidden: true, hidden_reason: "author_deleted" })
      .eq("id", id)
      .eq("author_user_id", auth.user_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
