/**
 * GET /api/waiting?store_uuid=&category=&limit=30
 *   활성 대기 요청 목록 (전체 매장). status='active' + not expired.
 * POST /api/waiting
 *   본 매장 대기 요청 등록.
 *   body: {
 *     categories: string[],   // ['퍼블릭', '하퍼']
 *     guest_count?: number,   // 3인
 *     room_count?: number,    // 1빵
 *     tags?: string[],        // ['땁','새방','장타']
 *     guest_note?: string,    // '50대 사장님 생일'
 *     origin_chat_message_id?: string
 *   }
 *
 * R-waiting (2026-07-07).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const supabase = getServiceClient()
    const url = new URL(request.url)
    const storeUuid = url.searchParams.get("store_uuid")
    const category = url.searchParams.get("category")
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "30", 10) || 30)

    let query = supabase
      .from("waiting_requests")
      .select(
        "id, store_uuid, requester_user_id, categories, guest_count, room_count, tags, guest_note, status, matched_at, created_at, expires_at",
      )
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(limit)

    if (storeUuid) query = query.eq("store_uuid", storeUuid)
    if (category) query = query.contains("categories", [category])

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    // 매장 이름 병합
    const rows = (data ?? []) as Array<{ store_uuid: string; [k: string]: unknown }>
    const storeIds = [...new Set(rows.map((r) => r.store_uuid))]
    const nameMap = new Map<string, string>()
    if (storeIds.length > 0) {
      const { data: st } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", storeIds)
      for (const s of ((st ?? []) as Array<{ id: string; store_name: string }>)) {
        nameMap.set(s.id, s.store_name)
      }
    }
    const enriched = rows.map((r) => ({ ...r, store_name: nameMap.get(r.store_uuid) ?? null }))
    return NextResponse.json({ requests: enriched })
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
      categories?: string[]
      guest_count?: number
      room_count?: number
      tags?: string[]
      guest_note?: string
      origin_chat_message_id?: string
    }
    if (!body.categories || body.categories.length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "categories required" },
        { status: 400 },
      )
    }
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from("waiting_requests")
      .insert({
        store_uuid: auth.store_uuid,
        requester_user_id: auth.user_id,
        requester_membership_id: auth.membership_id,
        categories: body.categories,
        guest_count: body.guest_count ?? null,
        room_count: body.room_count ?? 1,
        tags: body.tags ?? [],
        guest_note: body.guest_note ?? null,
        origin_chat_message_id: body.origin_chat_message_id ?? null,
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
