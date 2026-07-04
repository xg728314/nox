/**
 * GET /api/advertiser/profile     내 광고주 프로필 조회 (없으면 null)
 * PUT /api/advertiser/profile     upsert (본인 정보)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("advertiser_profiles")
      .select("*")
      .eq("user_id", auth.user_id)
      .maybeSingle()
    return NextResponse.json({ profile: data ?? null })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const supabase = getServiceClient()
    const patch: Record<string, unknown> = {
      user_id: auth.user_id,
      updated_at: new Date().toISOString(),
    }
    for (const k of [
      "business_name", "business_number", "business_owner", "business_address",
      "business_address_detail", "contact_phone", "contact_kakao", "logo_url",
      "default_thumbnail_url",
    ]) {
      if (k in body) patch[k] = body[k]
    }
    const { error } = await supabase
      .from("advertiser_profiles")
      .upsert(patch, { onConflict: "user_id" })
    if (error) {
      return NextResponse.json({ error: "UPSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
