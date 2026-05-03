import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getStoreStaff } from "@/lib/server/queries/store/staff"
import { loadAttendanceVisibility } from "@/lib/server/queries/ops/attendanceVisibility"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: BulkManagerPicker / hostess pool 등 자주 호출 →
//   동일 store + role 조합은 5초간 캐시. 변경 빈도 낮은 데이터.
const STAFF_TTL_MS = 5000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const storeNameParam = searchParams.get("store_name")
    const storeUuidParam = searchParams.get("store_uuid")
    const roleParam = searchParams.get("role")

    // 2026-05-03 R-Privacy: store_name 을 URL query 에 노출하는 호출 HARD REJECT.
    //   브라우저 히스토리·access log·CDN log·Sentry breadcrumb 에 평문으로 남아
    //   영업 비밀 (매장 한글명) 이 새어나간다. 이는 명백한 PII 누출.
    //
    //   대체 경로:
    //     1) store_uuid query param 사용 (권장 — UUID 는 의미 없는 식별자)
    //     2) POST /api/store/staff body { store_name } (이름만 알 때)
    //
    //   배포 직후 OLD bundle 호환을 위해 일시적으로 fallback 허용했었으나,
    //   사용자가 production access log 에서 매장명 노출을 반복 발견 →
    //   400 reject 로 격상. OLD bundle 은 즉시 재배포 강제됨 (의도).
    if (storeNameParam && !storeUuidParam) {
      console.error(
        `[store/staff] PRIVACY VIOLATION REJECTED: store_name URL param used by ${authContext.role} ${authContext.membership_id}. ` +
        `URL leak to access logs. Use store_uuid or POST body.`
      )
      return NextResponse.json(
        {
          error: "STORE_NAME_IN_URL_FORBIDDEN",
          message: "매장명은 URL 에 포함할 수 없습니다. store_uuid 또는 POST body 사용.",
        },
        { status: 400 },
      )
    }

    try {
      // 2026-05-01 R-Counter-Speed: visibility + staff 병렬 fire.
      // 2026-05-03 R-Privacy: GET 경로는 store_name 절대 사용 불가.
      //   store_uuid 만 전달.
      // 2026-05-03 R-Speed-x10: TTL 캐시. 같은 (store, target_uuid, role) 조합은
      //   5초 내 hit. 캐시 key 에 caller membership_id 포함 (manager mine_only filter).
      const cacheKey = `${authContext.store_uuid}:${storeUuidParam ?? ""}:${roleParam ?? ""}:${authContext.membership_id}`
      const data = await cached(
        "store_staff",
        cacheKey,
        STAFF_TTL_MS,
        async () => {
          const [visibilityMode, rawData] = await Promise.all([
            loadAttendanceVisibility(getServiceClient(), authContext),
            getStoreStaff(
              authContext,
              {
                store_name: null,
                store_uuid: storeUuidParam,
                role: roleParam,
              },
              { visibilityMode: "store_shared" },
            ),
          ])

          // 실 visibility 가 mine_only 면 manager 본인 담당 hostess 만 노출.
          let staff = rawData.staff
          if (
            !authContext.is_super_admin &&
            authContext.role === "manager" &&
            visibilityMode === "mine_only"
          ) {
            staff = staff.filter((s) =>
              s.role !== "hostess" || s.manager_membership_id === authContext.membership_id
            )
          }
          return { ...rawData, staff, visibility_mode: visibilityMode }
        },
      )
      const res = NextResponse.json(data)
      res.headers.set("Cache-Control", "private, max-age=3, stale-while-revalidate=10")
      return res
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      console.error("store staff error:", msg)
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

/**
 * POST /api/store/staff
 *
 * 2026-05-03 R-Privacy: GET 변형의 query string 에 매장 한글명을 평문 노출하지
 *   않고 body 로 받는 경로. server access log / Sentry breadcrumb / 브라우저
 *   히스토리에 매장명이 남지 않는다.
 *
 * Body shape: { role?, store_name?, store_uuid? }  (semantics 동일)
 *
 * GET 동작과 동일한 결과를 반환 (visibility filtering, 응답 shape).
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      role?: string | null
      store_name?: string | null
      store_uuid?: string | null
    }

    try {
      const [visibilityMode, rawData] = await Promise.all([
        loadAttendanceVisibility(getServiceClient(), authContext),
        getStoreStaff(
          authContext,
          {
            store_name: typeof body.store_name === "string" ? body.store_name : null,
            store_uuid: typeof body.store_uuid === "string" ? body.store_uuid : null,
            role: typeof body.role === "string" ? body.role : null,
          },
          { visibilityMode: "store_shared" },
        ),
      ])

      let staff = rawData.staff
      if (
        !authContext.is_super_admin &&
        authContext.role === "manager" &&
        visibilityMode === "mine_only"
      ) {
        staff = staff.filter((s) =>
          s.role !== "hostess" || s.manager_membership_id === authContext.membership_id
        )
      }
      const data = { ...rawData, staff }
      return NextResponse.json({ ...data, visibility_mode: visibilityMode })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      console.error("store staff (POST) error:", msg)
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
