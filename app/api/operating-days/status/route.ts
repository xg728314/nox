import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"

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
      const { data: day } = await supabase
        .from("store_operating_days")
        .select("id, store_uuid, business_date, status, closed_at, closed_by")
        .eq("id", bdid)
        .eq("store_uuid", auth.store_uuid)
        .maybeSingle()
      if (!day) {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      }
      const { data: report } = await supabase
        .from("closing_reports")
        .select("id, status, confirmed_at")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_day_id", bdid)
        .maybeSingle()
      return NextResponse.json({
        business_day: day,
        closing_report: report,
        locked: day.status === "closed",
      })
    }

    const { data: rows } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status, closed_at")
      .eq("store_uuid", auth.store_uuid)
      .order("business_date", { ascending: false })
      .limit(10)

    return NextResponse.json({ days: rows ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
