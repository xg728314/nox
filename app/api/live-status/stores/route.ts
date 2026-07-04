/**
 * GET /api/live-status/stores?region_top=&category=
 *   실시간현황 페이지용. 매장 리스트 + 실시간 상태 정보 (store_status_info).
 *   지역 필터 (전체/강남/비강남/서울 외).
 *   종목 필터 (퍼블릭/쩜오/텐/일프로/호스트).
 */
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"

const REGION_MAP: Record<string, string[]> = {
  gangnam: ["강남구", "서초구", "송파구"],
  non_gangnam: [],  // 강남 외 서울
  outside: [],       // 서울 외
  all: [],
}

export async function GET(request: Request) {
  const supabase = getServiceClient()
  const url = new URL(request.url)
  const region = url.searchParams.get("region") ?? "all"
  const category = url.searchParams.get("category")

  const { data: stores } = await supabase
    .from("stores")
    .select("id, store_name, store_code, floor")
    .is("deleted_at", null)
  type Store = { id: string; store_name: string; store_code: string; floor: number | null }
  const storeRows = (stores ?? []) as Store[]

  // status_info join
  const { data: infos } = await supabase
    .from("store_status_info")
    .select("*")
  type Info = {
    store_uuid: string
    live_note: string | null
    is_24h: boolean | null
    event_text: string | null
    category_tags: string[] | null
    region_display: string | null
    badge: string | null
    entry_level: string | null
    updated_at: string
  }
  const infoMap = new Map<string, Info>()
  for (const i of ((infos ?? []) as Info[])) infoMap.set(i.store_uuid, i)

  let filtered = storeRows.map((s) => {
    const info = infoMap.get(s.id) ?? null
    return {
      id: s.id,
      store_name: s.store_name,
      store_code: s.store_code,
      floor: s.floor,
      live_note: info?.live_note ?? null,
      is_24h: info?.is_24h ?? false,
      event_text: info?.event_text ?? null,
      category_tags: info?.category_tags ?? [],
      region_display: info?.region_display ?? null,
      badge: info?.badge ?? null,
      entry_level: info?.entry_level ?? null,
      updated_at: info?.updated_at ?? null,
    }
  })

  if (category && category !== "all") {
    filtered = filtered.filter((s) => s.category_tags.includes(category))
  }
  if (region && region !== "all") {
    if (region === "gangnam") {
      filtered = filtered.filter((s) =>
        REGION_MAP.gangnam.some((r) => s.region_display?.includes(r)),
      )
    } else if (region === "non_gangnam") {
      filtered = filtered.filter(
        (s) =>
          s.region_display?.includes("서울") &&
          !REGION_MAP.gangnam.some((r) => s.region_display?.includes(r)),
      )
    } else if (region === "outside") {
      filtered = filtered.filter((s) => s.region_display && !s.region_display.includes("서울"))
    }
  }

  return NextResponse.json({ stores: filtered })
}
