/**
 * GET /api/choice-talk/rooms
 *   내 초이스톡 목록.
 * POST /api/choice-talk/rooms
 *   광고에서 톡 시작. body: { ad_id?, counterparty_user_id? }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("choice_talk_rooms")
      .select(
        "id, initiator_user_id, counterparty_user_id, ad_id, region_tag, category_tag, status, last_message_at, initiator_unread, counterparty_unread, created_at",
      )
      .or(`initiator_user_id.eq.${auth.user_id},counterparty_user_id.eq.${auth.user_id}`)
      .order("last_message_at", { ascending: false })
      .limit(50)
    return NextResponse.json({ rooms: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      ad_id?: string
      counterparty_user_id?: string
    }
    const supabase = getServiceClient()
    let counterparty: string | null = body.counterparty_user_id ?? null
    let regionTag: string | null = null
    let categoryTag: string | null = null
    if (body.ad_id) {
      if (!isValidUUID(body.ad_id)) {
        return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
      }
      const { data: ad } = await supabase
        .from("ads")
        .select("advertiser_user_id, category, region_top")
        .eq("id", body.ad_id)
        .maybeSingle()
      if (!ad) return NextResponse.json({ error: "AD_NOT_FOUND" }, { status: 404 })
      const a = ad as { advertiser_user_id: string; category: string; region_top: string | null }
      counterparty = a.advertiser_user_id
      regionTag = a.region_top
      categoryTag = a.category
      // contact_click_count 증가
      const { data: cur } = await supabase
        .from("ads")
        .select("contact_click_count")
        .eq("id", body.ad_id)
        .maybeSingle()
      if (cur) {
        await supabase
          .from("ads")
          .update({
            contact_click_count: (cur as { contact_click_count: number }).contact_click_count + 1,
          })
          .eq("id", body.ad_id)
      }
    }
    if (!counterparty) {
      return NextResponse.json({ error: "COUNTERPARTY_REQUIRED" }, { status: 400 })
    }
    if (counterparty === auth.user_id) {
      return NextResponse.json({ error: "SELF_TALK" }, { status: 400 })
    }
    // 기존 room 재사용
    const { data: existing } = await supabase
      .from("choice_talk_rooms")
      .select("id")
      .eq("initiator_user_id", auth.user_id)
      .eq("counterparty_user_id", counterparty)
      .eq("ad_id", body.ad_id ?? null)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, id: (existing as { id: string }).id, already: true })
    }
    const { data: created, error } = await supabase
      .from("choice_talk_rooms")
      .insert({
        initiator_user_id: auth.user_id,
        counterparty_user_id: counterparty,
        ad_id: body.ad_id ?? null,
        region_tag: regionTag,
        category_tag: categoryTag,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: (created as { id: string }).id })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
