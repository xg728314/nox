/**
 * /api/waitlist — 매장 대기 board
 *
 * POST: 대기 요청 등록 (자동 dedup · 같은 매장·같은 스펙 5분 내 중복 시 갱신)
 * GET:  scope=mine|building — 본 매장 or 건물 5-8F 전체 열람
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { isValidUUID } from "@/lib/validation"

type Category = "퍼블릭" | "하퍼" | "셔츠" | "any"
type SeenPolicy = "unseen_only" | "any"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{
      category?: Category
      party_size?: number
      room_count?: number
      is_new_room?: boolean
      seen_policy?: SeenPolicy
      tags?: string[]
      note?: string
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    if (!b.category || !["퍼블릭", "하퍼", "셔츠", "any"].includes(b.category)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "category invalid" }, { status: 400 })
    }
    if (!b.party_size || b.party_size < 1 || b.party_size > 30) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "party_size 1-30" }, { status: 400 })
    }
    const roomCount = Math.max(1, Math.min(10, b.room_count ?? 1))
    const isNewRoom = b.is_new_room !== false
    const seenPolicy: SeenPolicy = b.seen_policy === "unseen_only" ? "unseen_only" : "any"
    const tags = Array.isArray(b.tags) ? b.tags.filter(t => typeof t === "string").slice(0, 8) : []
    const note = typeof b.note === "string" ? b.note.slice(0, 200) : null

    const sb = getServiceClient()

    // R-dedup (2026-09-04): 5분 내 같은 매장·같은 스펙 요청 있으면 갱신 (신규 X)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    const { data: dup } = await sb.from("waitlist_requests")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("category", b.category)
      .eq("party_size", b.party_size)
      .eq("room_count", roomCount)
      .eq("status", "active")
      .gte("created_at", fiveMinAgo)
      .limit(1).maybeSingle()

    if (dup) {
      // 기존 갱신 (expires_at 밀기 · updated_at)
      await sb.from("waitlist_requests").update({
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
        tags, note, seen_policy: seenPolicy, is_new_room: isNewRoom,
      }).eq("id", dup.id)
      return NextResponse.json({ id: dup.id, dedup: true })
    }

    const { data: created, error } = await sb.from("waitlist_requests").insert({
      store_uuid: auth.store_uuid,
      author_membership_id: auth.membership_id,
      category: b.category,
      party_size: b.party_size,
      room_count: roomCount,
      is_new_room: isNewRoom,
      seen_policy: seenPolicy,
      tags, note,
    }).select("id").single()

    if (error) return NextResponse.json({ error: "CREATE_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ id: (created as { id: string }).id, dedup: false })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const scope = url.searchParams.get("scope") ?? "building"
    const sb = getServiceClient()

    // expired 자동 정리 (본 요청 계기)
    await sb.from("waitlist_requests")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString())

    // 건물 5-8F 매장 대상 (auth.role 관계없이 열람 가능 · 담당 실장·사장·아가씨)
    let query = sb.from("waitlist_requests")
      .select("id, store_uuid, category, party_size, room_count, is_new_room, seen_policy, tags, note, status, created_at, expires_at, author_membership_id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50)

    if (scope === "mine") {
      query = query.eq("store_uuid", auth.store_uuid)
    }
    // building scope = 전 매장 (필터 없음)

    const { data: rows, error } = await query
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })

    // 매장 이름 매핑
    const storeIds = [...new Set((rows ?? []).map(r => r.store_uuid))]
    const { data: stores } = await sb.from("stores").select("id, store_name, floor").in("id", storeIds)
    const storeMap = new Map((stores ?? []).map(s => [s.id, s]))

    const items = (rows ?? []).map(r => ({
      ...r,
      store_name: storeMap.get(r.store_uuid)?.store_name ?? "?",
      floor: storeMap.get(r.store_uuid)?.floor,
      is_mine: r.store_uuid === auth.store_uuid,
    }))

    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
