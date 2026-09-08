/**
 * /api/waitlist — 매장 대기 board
 *
 * R38 (2026-09-09): twin-table 통합.
 *   이전엔 `waitlist_requests` (mig 095) 를 참조 · autoProcessMessage 는 `waiting_requests` (mig 140) 에 저장 → 홈 배지 항상 0.
 *   이제 `waiting_requests` 로 통일. 컬럼 매핑:
 *     party_size → guest_count · category → categories[0] · seen_policy/is_new_room → tags 에 편입
 *     author_membership_id → requester_membership_id (+ requester_user_id)
 *
 * POST: 대기 요청 등록 (같은 매장·같은 스펙 5분 내 중복 → 갱신)
 * GET:  scope=mine|building — 본 매장 or 전체 열람
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"

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
    const rawTags = Array.isArray(b.tags) ? b.tags.filter(t => typeof t === "string").slice(0, 8) : []
    // is_new_room / seen_policy 를 tags 에 편입 (waiting_requests 는 별도 컬럼 없음)
    const tagSet = new Set(rawTags)
    if (isNewRoom) tagSet.add("새방")
    else tagSet.add("체인지")
    if (seenPolicy === "unseen_only") tagSet.add("안본인원")
    const tags = [...tagSet]
    const note = typeof b.note === "string" ? b.note.slice(0, 200) : null

    const sb = getServiceClient()

    // 5분 내 dedup (같은 매장 · categories 첫원소 · guest_count · room_count · active)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    const { data: dup } = await sb.from("waiting_requests")
      .select("id, categories")
      .eq("store_uuid", auth.store_uuid)
      .eq("guest_count", b.party_size)
      .eq("room_count", roomCount)
      .eq("status", "active")
      .gte("created_at", fiveMinAgo)
      .limit(20)
    // categories 배열 요소로 dedup (JS 필터)
    const dupRow = ((dup ?? []) as Array<{ id: string; categories: string[] | null }>).find(r =>
      Array.isArray(r.categories) && r.categories.includes(b.category!),
    )

    if (dupRow) {
      await sb.from("waiting_requests").update({
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
        tags,
        guest_note: note,
      }).eq("id", dupRow.id)
      return NextResponse.json({ id: dupRow.id, dedup: true })
    }

    const { data: created, error } = await sb.from("waiting_requests").insert({
      store_uuid: auth.store_uuid,
      requester_user_id: auth.user_id,
      requester_membership_id: auth.membership_id,
      categories: [b.category],
      guest_count: b.party_size,
      room_count: roomCount,
      tags,
      guest_note: note,
      status: "active",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
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

    // expired 자동 정리
    // R42-fix (Agent #12): store_uuid scope 추가 · 매 GET 마다 전 매장 UPDATE 방지.
    //   본 매장 것만 만료 처리. 전체 정리는 cron 이 담당.
    await sb.from("waiting_requests")
      .update({ status: "expired" })
      .eq("status", "active")
      .eq("store_uuid", auth.store_uuid)
      .lt("expires_at", new Date().toISOString())

    let query = sb.from("waiting_requests")
      .select("id, store_uuid, categories, guest_count, room_count, tags, guest_note, status, created_at, expires_at, requester_membership_id, origin_chat_message_id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50)

    if (scope === "mine") {
      query = query.eq("store_uuid", auth.store_uuid)
    }

    const { data: rows, error } = await query
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })

    // 매장 이름 매핑
    const storeIds = [...new Set((rows ?? []).map((r: { store_uuid: string }) => r.store_uuid))]
    const { data: stores } = storeIds.length > 0
      ? await sb.from("stores").select("id, store_name, floor").in("id", storeIds)
      : { data: [] as Array<{ id: string; store_name: string; floor: number | null }> }
    const storeMap = new Map(((stores ?? []) as Array<{ id: string; store_name: string; floor: number | null }>).map(s => [s.id, s]))

    // legacy field 이름 매핑 (client 호환)
    type Row = { id: string; store_uuid: string; categories: string[] | null; guest_count: number; room_count: number; tags: string[]; guest_note: string | null; status: string; created_at: string; expires_at: string; requester_membership_id: string; origin_chat_message_id: string | null }
    const items = (rows ?? []).map((r: Row) => {
      const category = Array.isArray(r.categories) && r.categories.length > 0 ? r.categories[0] : "any"
      const isNewRoom = !(r.tags ?? []).includes("체인지")
      const seenPolicy = (r.tags ?? []).includes("안본인원") ? "unseen_only" : "any"
      return {
        id: r.id,
        store_uuid: r.store_uuid,
        category,
        party_size: r.guest_count,
        room_count: r.room_count,
        is_new_room: isNewRoom,
        seen_policy: seenPolicy,
        tags: r.tags ?? [],
        note: r.guest_note,
        status: r.status,
        created_at: r.created_at,
        expires_at: r.expires_at,
        author_membership_id: r.requester_membership_id,
        origin_chat_message_id: r.origin_chat_message_id,
        store_name: storeMap.get(r.store_uuid)?.store_name ?? "?",
        floor: storeMap.get(r.store_uuid)?.floor,
        is_mine: r.store_uuid === auth.store_uuid,
      }
    })

    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
