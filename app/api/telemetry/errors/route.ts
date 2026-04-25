import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/telemetry/errors?hours=24
 *   owner 만. 본인 매장 + 익명(store null) 최근 에러.
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN" },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? 24)))
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase
      .from("system_errors")
      .select("id, store_uuid, actor_role, tag, error_name, error_message, stack, digest, url, user_agent, extra, created_at")
      .or(`store_uuid.eq.${auth.store_uuid},store_uuid.is.null`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    // 태그별 집계
    const tagCounts = new Map<string, number>()
    for (const row of data ?? []) {
      const t = (row.tag as string) || "(untagged)"
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
    const tagSummary = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      hours,
      total: data?.length ?? 0,
      errors: data ?? [],
      tag_summary: tagSummary,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
