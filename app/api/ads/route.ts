/**
 * GET /api/ads
 *   목록 조회 (region/category/keyword 필터 · pinned 우선 · pagination).
 *   Query: ?region_top=&region_sub=&category=&q=&limit=20&cursor=<created_at>
 *
 * POST /api/ads
 *   광고 등록. 필요 필드: title, category, region_top, region_sub, tc_amount.
 *   광고주 프로필 자동 생성 (없으면).
 *
 * R-marketplace-ads (2026-07-05).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    // 목록은 공개 — auth 실패해도 OK
    const supabase = getServiceClient()
    const url = new URL(request.url)
    const regionTop = url.searchParams.get("region_top")
    const regionSub = url.searchParams.get("region_sub")
    const category = url.searchParams.get("category")
    const q = url.searchParams.get("q")
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20)
    const cursor = url.searchParams.get("cursor")

    let query = supabase
      .from("ads")
      .select(
        "id, title, category, region_top, region_sub, tc_amount, thumbnail_url, view_count, like_count, is_pinned, start_at, created_at, advertiser_user_id",
      )
      .eq("status", "active")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit)

    if (regionTop) query = query.eq("region_top", regionTop)
    if (regionSub) query = query.eq("region_sub", regionSub)
    if (category) query = query.eq("category", category)
    if (q) query = query.ilike("title", `%${q}%`)
    if (cursor) query = query.lt("created_at", cursor)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ads: data ?? [] })
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
      title?: string
      body?: string
      category?: string
      region_top?: string
      region_sub?: string
      region_detail?: string
      tc_amount?: number
      thumbnail_url?: string
      image_urls?: string[]
      contact_phone?: string
      contact_kakao?: string
      store_uuid?: string
      end_at?: string
    }
    if (!body.title || !body.category || !body.region_top) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "title + category + region_top required" },
        { status: 400 },
      )
    }
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from("ads")
      .insert({
        advertiser_user_id: auth.user_id,
        store_uuid: body.store_uuid ?? null,
        title: body.title,
        body: body.body ?? null,
        category: body.category,
        region_top: body.region_top,
        region_sub: body.region_sub ?? null,
        region_detail: body.region_detail ?? null,
        tc_amount: body.tc_amount ?? null,
        thumbnail_url: body.thumbnail_url ?? null,
        image_urls: body.image_urls ?? [],
        contact_phone: body.contact_phone ?? null,
        contact_kakao: body.contact_kakao ?? null,
        end_at: body.end_at ?? null,
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
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}
