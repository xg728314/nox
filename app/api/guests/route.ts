/**
 * GET /api/guests?q=&limit=30   내 매장 손님 목록 (검색).
 * POST /api/guests               손님 프로필 생성/수정 (upsert by display_name+store).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const q = url.searchParams.get("q")
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "30", 10) || 30)
    const supabase = getServiceClient()
    let query = supabase
      .from("guest_profiles")
      .select("*")
      .eq("store_uuid", auth.store_uuid)
      .order("last_visit_at", { ascending: false, nullsFirst: false })
      .limit(limit)
    if (q?.trim()) query = query.or(`display_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`)
    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ guests: data ?? [] })
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
      display_name?: string
      phone?: string
      tags?: string[]
      style_prefs?: string[]
      memo?: string
    }
    if (!body.display_name?.trim()) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "display_name required" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from("guest_profiles")
      .insert({
        store_uuid: auth.store_uuid,
        display_name: body.display_name.trim(),
        phone: body.phone?.trim() ?? null,
        tags: body.tags ?? [],
        style_prefs: body.style_prefs ?? [],
        memo: body.memo ?? null,
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
