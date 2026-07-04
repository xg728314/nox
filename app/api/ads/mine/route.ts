/**
 * GET /api/ads/mine — 내 광고 목록 (광고관리 페이지용).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("ads")
      .select(
        "id, title, category, region_top, region_sub, tc_amount, thumbnail_url, view_count, like_count, contact_click_count, status, start_at, end_at, created_at",
      )
      .eq("advertiser_user_id", auth.user_id)
      .order("created_at", { ascending: false })
    return NextResponse.json({ ads: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
