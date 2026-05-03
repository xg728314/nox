import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: stores 정보는 거의 변경 X — 60초 TTL 충분.
//   super_admin 의 모든 페이지 진입 시 호출됨 (StoreContextBar dropdown).
const STORES_TTL_MS = 60_000

/**
 * GET /api/super-admin/stores-list
 *
 * R-StoreSwitch (2026-05-01 복구):
 *   super_admin 이 멤버십 없는 매장도 cookie override 로 전환 가능 →
 *   owner page 의 "다른 매장으로 전환" 에서 본인 멤버십 매장 + 전체 매장
 *   둘 다 보여야 한다.
 *
 *   /api/auth/memberships 는 본인 row 만 반환 (보안). super_admin 의 경우엔
 *   별도 endpoint 가 모든 매장 list 를 반환해야 함.
 *
 * 가드: super_admin only. 그 외 403.
 *
 * 응답:
 *   { stores: [{ store_uuid, store_name, floor_no }, ...] }
 *   deleted_at IS NULL active 매장만.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "super_admin only" },
        { status: 403 },
      )
    }

    // 2026-05-03 fix: stores 테이블 컬럼은 `floor` 임 (`floor_no` 아님).
    //   기존 select/order 가 floor_no 로 작성되어 PG 가 컬럼 부재로 500 반환 →
    //   /owner 페이지 super_admin 매장 목록 fetch 가 실패하던 문제.
    // 2026-05-03 R-Speed-x10: stores 변경 빈도 매우 낮음 (월 1~2회) → 60초 TTL.
    //   super_admin 페이지 진입마다 호출되던 부담 제거.
    const stores = await cached(
      "super_admin_stores_list",
      "all",
      STORES_TTL_MS,
      async () => {
        const supabase = supa()
        const { data, error } = await supabase
          .from("stores")
          .select("id, store_name, floor")
          .is("deleted_at", null)
          .order("floor", { ascending: true, nullsFirst: false })
          .order("store_name", { ascending: true })

        if (error) {
          throw new Error(`DB_ERROR:${error.message}`)
        }

        // 응답 형태는 floor_no 로 유지 (클라이언트 호환). 서버 측에서 floor → floor_no 매핑.
        return (data ?? []).map((s) => ({
          store_uuid: s.id,
          store_name: s.store_name,
          floor_no: s.floor,
        }))
      },
    )

    const res = NextResponse.json({ stores })
    // 브라우저/CDN 캐시: stores list 는 30초 신선도 + 2분 SWR 충분.
    res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120")
    return res
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    // cached() 내부 throw 된 DB_ERROR 메시지 그대로 노출 (디버깅 편의).
    if (e instanceof Error && e.message.startsWith("DB_ERROR:")) {
      return NextResponse.json(
        { error: "DB_ERROR", message: e.message.slice("DB_ERROR:".length) },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
