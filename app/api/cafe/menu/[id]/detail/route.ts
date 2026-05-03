import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/cafe/menu/[id]/detail — 메뉴 상세 (메뉴 + 옵션 그룹/옵션 + 리뷰 + 평점 요약).
 *   배민 스타일 상세 모달용. 인증된 누구나.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await resolveAuthContext(request)
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1) 메뉴
    const { data: menu } = await supabase
      .from("cafe_menu_items")
      .select("id, store_uuid, name, category, price, description, description_long, image_url, thumbnail_url, is_active, deleted_at")
      .eq("id", id)
      .maybeSingle()
    if (!menu || menu.deleted_at || !menu.is_active) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    // 2) 옵션 그룹 + 옵션 (병렬)
    const [groupsRes, optionsRes, reviewsRes, summaryRes] = await Promise.all([
      supabase.from("cafe_menu_option_groups")
        .select("id, name, is_required, min_select, max_select, sort_order")
        .eq("menu_id", id).eq("is_active", true).is("deleted_at", null)
        .order("sort_order"),
      supabase.from("cafe_menu_options")
        .select("id, group_id, name, price_delta, is_default, sort_order")
        .eq("is_active", true).is("deleted_at", null)
        .order("sort_order"),
      supabase.from("cafe_reviews")
        .select("id, rating, text, created_at, customer_membership_id")
        .eq("menu_id", id).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(20),
      supabase.from("cafe_reviews")
        .select("rating", { count: "exact" })
        .eq("menu_id", id).is("deleted_at", null),
    ])

    type Grp = { id: string; name: string; is_required: boolean; min_select: number; max_select: number; sort_order: number }
    type Opt = { id: string; group_id: string; name: string; price_delta: number; is_default: boolean; sort_order: number }
    const groupList = (groupsRes.data ?? []) as Grp[]
    const optList = ((optionsRes.data ?? []) as Opt[])
      .filter((o) => groupList.find((g) => g.id === o.group_id))
    const optByGroup = new Map<string, Opt[]>()
    for (const o of optList) {
      const arr = optByGroup.get(o.group_id) ?? []
      arr.push(o)
      optByGroup.set(o.group_id, arr)
    }
    const groupsWithOpts = groupList.map((g) => ({ ...g, options: optByGroup.get(g.id) ?? [] }))

    // 평점 요약
    const ratings = (summaryRes.data ?? []) as Array<{ rating: number }>
    const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null
    const reviewCount = summaryRes.count ?? ratings.length

    // 리뷰에 작성자 이름 enrich
    const reviewRows = (reviewsRes.data ?? []) as Array<{ id: string; rating: number; text: string | null; created_at: string; customer_membership_id: string }>
    let nameMap = new Map<string, string>()
    if (reviewRows.length > 0) {
      const mids = Array.from(new Set(reviewRows.map((r) => r.customer_membership_id)))
      const { data: mems } = await supabase
        .from("store_memberships").select("id, profile_id").in("id", mids)
      const memToProfile = new Map<string, string>()
      for (const m of (mems ?? []) as Array<{ id: string; profile_id: string | null }>) {
        if (m.profile_id) memToProfile.set(m.id, m.profile_id)
      }
      const profIds = Array.from(new Set(Array.from(memToProfile.values())))
      if (profIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, nickname").in("id", profIds)
        for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; nickname: string | null }>) {
          nameMap.set(p.id, p.nickname || p.full_name || "")
        }
      }
      // mid → name
      const finalNameMap = new Map<string, string>()
      for (const [mid, pid] of memToProfile) {
        finalNameMap.set(mid, nameMap.get(pid) ?? "")
      }
      nameMap = finalNameMap
    }
    const reviews = reviewRows.map((r) => ({
      id: r.id, rating: r.rating, text: r.text, created_at: r.created_at,
      customer_name: nameMap.get(r.customer_membership_id) || "익명",
    }))

    return NextResponse.json({
      menu: {
        id: menu.id, store_uuid: menu.store_uuid, name: menu.name, category: menu.category,
        price: menu.price, description: menu.description, description_long: menu.description_long,
        image_url: menu.image_url, thumbnail_url: menu.thumbnail_url ?? menu.image_url,
      },
      option_groups: groupsWithOpts,
      reviews,
      review_summary: { avg_rating: avgRating, count: reviewCount },
    })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/detail")
  }
}
