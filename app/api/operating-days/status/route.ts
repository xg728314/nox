import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 영업일 상태는 영업 중에는 거의 안 바뀜.
//   close/reopen 시점에만 변화. 10초 TTL 충분.
const STATUS_TTL_MS = 10_000

/**
 * STEP-017: GET /api/operating-days/status
 *
 * Read the current open/closed state of a business day.
 * Owner/manager only. Pure read — no snapshot content (see /snapshot).
 *
 * Query:
 *   ?business_day_id=<uuid>  — specific day
 *   (none)                   — returns the most recent 10 days for the store
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()
    const url = new URL(request.url)
    const rawId = url.searchParams.get("business_day_id")

    if (rawId) {
      const bdid = parseUuid(rawId)
      if (!bdid) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "business_day_id must be a valid uuid." },
          { status: 400 }
        )
      }
      // 2026-05-03 R-Speed-x10: day + report 직렬 → Promise.all (둘 다 bdid 만 의존).
      const [dayRes, reportRes] = await Promise.all([
        supabase
          .from("store_operating_days")
          .select("id, store_uuid, business_date, status, closed_at, closed_by")
          .eq("id", bdid)
          .eq("store_uuid", auth.store_uuid)
          .maybeSingle(),
        supabase
          .from("closing_reports")
          .select("id, status, confirmed_at")
          .eq("store_uuid", auth.store_uuid)
          .eq("business_day_id", bdid)
          .maybeSingle(),
      ])
      const day = dayRes.data
      if (!day) {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      }
      const res = NextResponse.json({
        business_day: day,
        closing_report: reportRes.data,
        locked: day.status === "closed",
      })
      res.headers.set("Cache-Control", "private, max-age=5, stale-while-revalidate=30")
      return res
    }

    type DayRow = { id: string; business_date: string; status: string; closed_at: string | null }
    const rows = await cached<DayRow[]>(
      "operating_days_recent",
      auth.store_uuid,
      STATUS_TTL_MS,
      async () => {
        const { data } = await supabase
          .from("store_operating_days")
          .select("id, business_date, status, closed_at")
          .eq("store_uuid", auth.store_uuid)
          .order("business_date", { ascending: false })
          .limit(10)
        return (data ?? []) as DayRow[]
      },
    )

    const res = NextResponse.json({ days: rows })
    res.headers.set("Cache-Control", "private, max-age=5, stale-while-revalidate=30")
    return res
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
