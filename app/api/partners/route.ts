/**
 * GET /api/partners?category=hair&region_top=&limit=30
 *   파트너 목록 (플레이스 탭용).
 * GET /api/partners/categories
 *   6개 카테고리 목록.
 */
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  const supabase = getServiceClient()
  const url = new URL(request.url)
  const category = url.searchParams.get("category")
  const regionTop = url.searchParams.get("region_top")
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "30", 10) || 30)

  let query = supabase
    .from("partners")
    .select(
      "id, category_id, name, description, address, region_top, region_sub, phone, thumbnail_url, banner_url, discount_percent, special_offer, tags, is_featured, is_new, view_count, like_count",
    )
    .eq("status", "active")
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)

  if (category) {
    // slug 로 category_id 조회
    const { data: cat } = await supabase
      .from("partner_categories")
      .select("id")
      .eq("slug", category)
      .maybeSingle()
    if (cat) query = query.eq("category_id", (cat as { id: string }).id)
  }
  if (regionTop) query = query.eq("region_top", regionTop)
  const { data } = await query
  return NextResponse.json({ partners: data ?? [] })
}
