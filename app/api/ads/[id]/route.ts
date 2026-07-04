/**
 * GET /api/ads/[id]
 *   상세 조회 + view_count 증가.
 * PATCH /api/ads/[id]
 *   본인 광고 수정.
 * DELETE /api/ads/[id]
 *   본인 광고 삭제 (status=expired).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("ads")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    // view_count 증가 (비동기, 실패 무시)
    void supabase
      .from("ads")
      .update({ view_count: (data as { view_count: number }).view_count + 1 })
      .eq("id", id)
    // 광고주 사업자 정보 (show_business_info 이 true 일 때만)
    const ad = data as {
      id: string
      show_business_info: boolean
      advertiser_user_id: string
      contact_phone: string | null
      contact_kakao: string | null
    }
    let advertiser: unknown = null
    if (ad.show_business_info) {
      const { data: ap } = await supabase
        .from("advertiser_profiles")
        .select("business_name, business_owner, business_address, business_address_detail")
        .eq("user_id", ad.advertiser_user_id)
        .maybeSingle()
      advertiser = ap
    }
    return NextResponse.json({ ad: data, advertiser })
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const supabase = getServiceClient()
    const { data: existing } = await supabase
      .from("ads")
      .select("advertiser_user_id")
      .eq("id", id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if ((existing as { advertiser_user_id: string }).advertiser_user_id !== auth.user_id
        && !auth.is_super_admin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const allowed = [
      "title", "body", "category", "region_top", "region_sub", "region_detail",
      "tc_amount", "thumbnail_url", "image_urls", "contact_phone", "contact_kakao",
      "end_at", "status", "show_business_info",
    ] as const
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of allowed) if (k in body) patch[k] = body[k]
    const { error } = await supabase.from("ads").update(patch).eq("id", id)
    if (error) return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
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
      .from("ads")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("advertiser_user_id", auth.user_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
