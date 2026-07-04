/**
 * GET /api/community/posts?board=free&sort=latest&q=&limit=20&cursor=
 *   목록 조회. board 별 필터. sort=latest | hot.
 * POST /api/community/posts
 *   게시글 작성. body: { board, title, body, image_urls?, tags? }
 *
 * R-marketplace-community (2026-07-05).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

const BOARDS = new Set(["free", "hot", "promo", "corporate", "life", "notice"])

export async function GET(request: Request) {
  try {
    const supabase = getServiceClient()
    const url = new URL(request.url)
    const board = url.searchParams.get("board") ?? "free"
    const sort = url.searchParams.get("sort") ?? "latest"
    const q = url.searchParams.get("q")
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20)
    const cursor = url.searchParams.get("cursor")

    let query = supabase
      .from("community_posts")
      .select(
        "id, author_user_id, author_nickname, board, title, body, view_count, like_count, comment_count, is_notice, created_at",
      )
      .eq("is_hidden", false)
      .limit(limit)

    if (board !== "all") query = query.eq("board", board)
    if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`)

    if (sort === "hot") {
      query = query.order("hot_score", { ascending: false })
    } else {
      query = query.order("is_notice", { ascending: false }).order("created_at", { ascending: false })
      if (cursor) query = query.lt("created_at", cursor)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ posts: data ?? [] })
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      board?: string
      title?: string
      body?: string
      image_urls?: string[]
      tags?: string[]
      nickname?: string
    }
    if (!body.board || !BOARDS.has(body.board)) {
      return NextResponse.json({ error: "BAD_BOARD" }, { status: 400 })
    }
    if (!body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "title + body required" }, { status: 400 })
    }
    const supabase = getServiceClient()
    // 닉네임 — 명시 안 하면 user_public_profiles 에서 조회
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
      .from("community_posts")
      .insert({
        author_user_id: auth.user_id,
        author_nickname: nickname,
        board: body.board,
        title: body.title.trim(),
        body: body.body.trim(),
        image_urls: body.image_urls ?? [],
        tags: body.tags ?? [],
      })
      .select("id")
      .single()
    if (error) {
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
