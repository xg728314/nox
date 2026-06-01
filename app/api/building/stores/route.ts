import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { cached } from "@/lib/cache/inMemoryTtl"

// R-mobile (2026-06-01): 스태프동기화 모바일 앱이 cross-store 등록 시점에
//   목적지 매장을 골라야 함. 5~8F 의 전체 매장 목록 (이름 + floor) 제공.
//   매장 추가/이름 변경 빈도 매우 낮음 → 5분 TTL.
const STORES_TTL_MS = 300_000

type StoreRow = {
  id: string
  store_name: string
  floor: number | null
}

export async function GET(request: Request) {
  try {
    // 인증된 사용자면 누구나 (cross-store registration 가시성 필요).
    await resolveAuthContext(request)

    const payload = await cached<{ stores: Array<{ store_uuid: string; store_name: string; floor: number | null }> }>(
      "building_stores",
      "v1",
      STORES_TTL_MS,
      async () => {
        const sb = getServiceClient()
        const { data, error } = await sb
          .from("stores")
          .select("id, store_name, floor")
          .is("deleted_at", null)
          .in("floor", [5, 6, 7, 8])
          .order("floor", { ascending: true })
          .order("store_name", { ascending: true })

        if (error) throw new Error("QUERY_FAILED")
        const stores = ((data as StoreRow[] | null) ?? []).map((s) => ({
          store_uuid: s.id,
          store_name: s.store_name,
          floor: typeof s.floor === "number" ? s.floor : null,
        }))
        return { stores }
      },
    )

    const res = NextResponse.json(payload)
    res.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.type, message: error.message },
        { status: error.status },
      )
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 },
    )
  }
}
