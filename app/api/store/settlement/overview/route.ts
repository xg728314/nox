import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getStoreSettlementOverview } from "@/lib/server/queries/store/settlementOverview"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 정산 overview 는 영업 중에 자주 바뀌지만 (체크아웃마다)
//   사용자가 owner 페이지에 머무르는 동안 N초마다 polling. 5초 TTL + SWR 로 충분.
//   현재 영업일 (business_day_id 없음) vs 과거 영업일 (closed) 둘 다 캐시 안전.
const OVERVIEW_TTL_MS = 5000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "hostess"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const paramBusinessDayId = searchParams.get("business_day_id")

    try {
      const cacheKey = `${authContext.store_uuid}:${authContext.role}:${authContext.membership_id}:${paramBusinessDayId ?? "today"}`
      const data = await cached(
        "store_settlement_overview",
        cacheKey,
        OVERVIEW_TTL_MS,
        () =>
          getStoreSettlementOverview(authContext, {
            business_day_id: paramBusinessDayId,
          }),
      )
      const res = NextResponse.json(data)
      res.headers.set(
        "Cache-Control",
        "private, max-age=3, stale-while-revalidate=15",
      )
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      return NextResponse.json(
        { error: "QUERY_FAILED", message: msg },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
