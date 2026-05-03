import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getStoreProfile } from "@/lib/server/queries/store/profile"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: store profile (이름/floor/타임존 등) 거의 안 바뀜.
//   여러 페이지가 mount 시 호출 → 60초 TTL 안전. cache hit 시 ~1ms.
const PROFILE_TTL_MS = 60_000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "hostess"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    try {
      const data = await cached(
        "store_profile",
        authContext.store_uuid,
        PROFILE_TTL_MS,
        () => getStoreProfile(authContext),
      )
      const res = NextResponse.json(data)
      res.headers.set(
        "Cache-Control",
        "private, max-age=30, stale-while-revalidate=300",
      )
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      if (msg === "STORE_NOT_FOUND") {
        return NextResponse.json(
          { error: "STORE_NOT_FOUND", message: "Store not found for this membership." },
          { status: 404 }
        )
      }
      throw e
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
